import { ROOT_CONTEXT, trace } from '@opentelemetry/api'

import { makeNoopSpan, makeNoopTracer } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Deferred, Effect, Fiber, Stream, TestClock, Tracer } from '@livestore/utils/effect'

import { makeObservability, rpcSpanOptions } from './observability.ts'

Vitest.describe('sync-cf telemetry ownership', () => {
  Vitest.afterEach(() => Vitest.vi.restoreAllMocks())

  Vitest.effect('runs sync effects and streams without exporting when telemetry is omitted', () =>
    Effect.gen(function* () {
      const fetch = Vitest.vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
      const observability = makeObservability(undefined)
      const result = yield* Effect.succeed('ack').pipe(Effect.withSpan('push'), observability.effect)
      const history = yield* Stream.make('event').pipe(Stream.withSpan('pull'), observability.stream, Stream.runCollect)

      yield* TestClock.adjust('4 seconds')
      Vitest.expect(result).toBe('ack')
      Vitest.expect(history).toEqual(['event'])
      Vitest.expect(fetch).not.toHaveBeenCalled()
    }),
  )

  Vitest.live('exports through the supplied provider after spans end without taking provider ownership', () =>
    Effect.gen(function* () {
      const { tracer, spans, ended } = makeRecordingTracer()
      const register = Vitest.vi.spyOn(trace, 'setGlobalTracerProvider')
      const flushed = Promise.withResolvers<ReadonlyArray<string>>()
      const provider = {
        getTracer: () => tracer,
        forceFlush: () => {
          flushed.resolve([...ended])
          return Promise.resolve()
        },
        shutdown: Vitest.vi.fn(),
      }
      const observability = makeObservability(provider)
      yield* Effect.void.pipe(Effect.withSpan('child'), Effect.withSpan('parent'), observability.effect)

      Vitest.expect(yield* Effect.promise(() => flushed.promise)).toEqual(['child', 'parent'])
      Vitest.expect(spans.get('child')?.parentId).toBe(spans.get('parent')?.spanId)
      Vitest.expect(register).not.toHaveBeenCalled()
      Vitest.expect(provider.shutdown).not.toHaveBeenCalled()
    }),
  )

  Vitest.effect('acknowledges during a blocked export and drains later spans even after the wait times out', () =>
    Effect.gen(function* () {
      const { tracer, ended } = makeRecordingTracer()
      // These promises model the SDK boundary. Test coordination and time remain under Effect.
      const gate = Promise.withResolvers<void>()
      const started = Promise.withResolvers<void>()
      const trailingFlush = Promise.withResolvers<ReadonlyArray<string>>()
      const acknowledged = yield* Deferred.make<void>()
      let calls = 0
      const forceFlush = () => {
        calls++
        if (calls === 1) {
          started.resolve()
          return gate.promise
        }
        trailingFlush.resolve([...ended])
        return Promise.resolve()
      }
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const observability = makeObservability({ getTracer: () => tracer, forceFlush })
      yield* Effect.void.pipe(
        Effect.withSpan('first push'),
        observability.effect,
        Effect.andThen(Deferred.succeed(acknowledged, undefined)),
        Effect.forkChild,
      )
      yield* Effect.promise(() => started.promise)
      yield* Effect.yieldNow
      Vitest.expect(yield* Deferred.isDone(acknowledged)).toBe(true)

      // Advance the actual Effect timeout, not Date.now or wall-clock sleeps.
      yield* TestClock.adjust('4 seconds')
      yield* Effect.void.pipe(Effect.withSpan('second push'), observability.effect)
      yield* TestClock.adjust(1)
      Vitest.expect(calls).toBe(1)

      gate.resolve()
      Vitest.expect(yield* Effect.promise(() => trailingFlush.promise)).toEqual(['first push', 'second push'])
    }),
  )

  Vitest.live.each(['reject', 'throw'] as const)('preserves sync results and recovers after a flush %s', (mode) =>
    Effect.gen(function* () {
      const failed = Promise.withResolvers<void>()
      const recovered = Promise.withResolvers<void>()
      let calls = 0
      const forceFlush = () => {
        calls++
        if (calls === 1) {
          failed.resolve()
          if (mode === 'throw') throw new Error('collector unavailable')
          return Promise.reject(new Error('collector unavailable'))
        }
        recovered.resolve()
        return Promise.resolve()
      }
      const observability = makeObservability({ getTracer: () => makeNoopTracer(), forceFlush })
      Vitest.expect(yield* Effect.succeed('ack').pipe(observability.effect)).toBe('ack')
      yield* Effect.promise(() => failed.promise)
      yield* Effect.yieldNow
      Vitest.expect(yield* Effect.fail('sync failed').pipe(observability.effect, Effect.flip)).toBe('sync failed')
      yield* Effect.promise(() => recovered.promise)
      Vitest.expect(calls).toBe(2)
    }),
  )

  Vitest.live('exports finite history while the live subscription is still open', () =>
    Effect.gen(function* () {
      const { tracer, ended } = makeRecordingTracer()
      const flushed = Promise.withResolvers<ReadonlyArray<string>>()
      const live = yield* Deferred.make<void>()
      const observability = makeObservability({
        getTracer: () => tracer,
        forceFlush: () => {
          flushed.resolve([...ended])
          return Promise.resolve()
        },
      })
      const fiber = yield* Stream.make('history').pipe(
        Stream.withSpan('pull-history'),
        observability.stream,
        Stream.concat(Stream.fromEffect(Deferred.succeed(live, undefined)).pipe(Stream.concat(Stream.never))),
        Stream.runDrain,
        Effect.forkChild,
      )
      yield* Effect.addFinalizer(() => Fiber.interrupt(fiber))
      yield* Deferred.await(live)
      Vitest.expect(yield* Effect.promise(() => flushed.promise)).toContain('pull-history')
      Vitest.expect(fiber.pollUnsafe()).toBeUndefined()
    }),
  )

  Vitest.live('attaches a finite span to the caller across an unexported RPC envelope', () =>
    Effect.gen(function* () {
      const { tracer, spans, ended } = makeRecordingTracer()
      const observability = makeObservability({ getTracer: () => tracer })
      const caller = Tracer.externalSpan({ traceId: '1'.repeat(32), spanId: '2222222222222222', sampled: true })
      yield* Effect.flatMap(rpcSpanOptions, (options) =>
        Effect.void.pipe(Effect.withSpan('push'), Effect.withSpan('finite-rpc', options)),
      ).pipe(observability.effect, Effect.withSpan('unexported-rpc-envelope'), Effect.withParentSpan(caller))

      Vitest.expect(spans.get('finite-rpc')?.parentId).toBe(caller.spanId)
      Vitest.expect(spans.get('push')?.parentId).toBe(spans.get('finite-rpc')?.spanId)
      Vitest.expect(ended).toEqual(['push', 'finite-rpc'])
    }),
  )

  Vitest.live('acknowledges before the owned OTLP collector responds', () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      const acknowledged = yield* Deferred.make<void>()
      Vitest.vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        started.resolve()
        return gate.promise.then(() => new Response('{}', { headers: { 'content-type': 'application/json' } }))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const observability = makeObservability({ baseUrl: 'http://collector.invalid' })
      yield* Effect.void.pipe(
        Effect.withSpan('push'),
        observability.effect,
        Effect.andThen(Deferred.succeed(acknowledged, undefined)),
        Effect.forkChild,
      )
      yield* Effect.promise(() => started.promise)
      yield* Effect.yieldNow
      Vitest.expect(yield* Deferred.isDone(acknowledged)).toBe(true)
    }),
  )
})

/** Record the public OTel boundary; span IDs are compared relationally, not fixed to creation order. */
const makeRecordingTracer = () => {
  const tracer = makeNoopTracer()
  const ended: string[] = []
  const spans = new Map<string, { spanId: string; parentId: string | undefined }>()
  let nextId = 0
  Vitest.vi.spyOn(tracer, 'startSpan').mockImplementation((name, _options, context) => {
    const spanId = (++nextId).toString(16).padStart(16, '0')
    spans.set(name, { spanId, parentId: trace.getSpanContext(context ?? ROOT_CONTEXT)?.spanId })
    return {
      ...makeNoopSpan(),
      spanContext: () => ({ traceId: '1'.repeat(32), spanId, traceFlags: 1 }),
      end: () => {
        ended.push(name)
      },
    }
  })
  return { tracer, ended, spans }
}
