import { ROOT_CONTEXT, type SpanStatus, SpanStatusCode, trace } from '@opentelemetry/api'

import { BackendIdMismatchError, UnknownError } from '@livestore/common'
import { type CfTypes, layerProtocolDurableObject, WsContext } from '@livestore/common-cf'
import { makeNoopSpan, makeNoopTracer } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Deferred,
  Effect,
  FetchHttpClient,
  Fiber,
  Layer,
  Option,
  OtelTracer,
  RpcClient,
  RpcTest,
  Schema,
  Stream,
  TestClock,
  Tracer,
} from '@livestore/utils/effect'

import { SyncDoRpc } from '../../common/do-rpc-schema.ts'
import { SyncWsRpc } from '../../common/ws-rpc-schema.ts'
import { WebSocketAttachmentSchema } from '../shared.ts'
import type * as DoCtx from './layer.ts'
import { makeObservability, rpcSpanOptions, withRpcSpan, withRpcStreamSpan } from './observability.ts'
import { createDoRpcHandler } from './transport/do-rpc-server.ts'
import { makeRpcHandlers } from './transport/ws-rpc-server.ts'

Vitest.describe('sync-cf telemetry ownership', () => {
  Vitest.afterEach(() => Vitest.vi.restoreAllMocks())

  Vitest.effect('runs sync effects and streams without exporting when telemetry is omitted', () =>
    Effect.gen(function* () {
      const fetch: typeof globalThis.fetch = Vitest.vi.fn(async () => new Response('{}'))
      const observability = makeObservability(undefined)
      const result = yield* Effect.succeed('ack').pipe(
        Effect.withSpan('push'),
        observability.effect,
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      const history = yield* Stream.make('event').pipe(
        Stream.withSpan('pull'),
        observability.stream,
        Stream.runCollect,
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )

      yield* TestClock.adjust('4 seconds')
      Vitest.expect(result).toBe('ack')
      Vitest.expect(history).toEqual(['event'])
      Vitest.expect(fetch).not.toHaveBeenCalled()
    }),
  )

  Vitest.effect('builds and finalizes a supplied layer independently for overlapping operations', () =>
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const firstGate = yield* Deferred.make<void>()
      const secondGate = yield* Deferred.make<void>()
      const firstReleased = yield* Deferred.make<void>()
      const secondReleased = yield* Deferred.make<void>()
      const builds: string[] = []
      const releases: string[] = []
      const layer = Layer.effectDiscard(
        Effect.acquireRelease(
          Effect.currentSpan.pipe(
            Effect.orDie,
            Effect.tap((span) => Effect.sync(() => builds.push(span.name))),
          ),
          (span) =>
            Effect.sync(() => releases.push(span.name)).pipe(
              Effect.andThen(Deferred.succeed(span.name === 'first' ? firstReleased : secondReleased, undefined)),
            ),
        ),
      )
      const observability = makeObservability(layer)
      const first = yield* Deferred.succeed(firstStarted, undefined).pipe(
        Effect.andThen(Deferred.await(firstGate)),
        observability.effect,
        Effect.withSpan('first'),
        Effect.forkChild,
      )
      yield* Deferred.await(firstStarted)
      const second = yield* Deferred.succeed(secondStarted, undefined).pipe(
        Effect.andThen(Deferred.await(secondGate)),
        observability.effect,
        Effect.withSpan('second'),
        Effect.forkChild,
      )
      yield* Deferred.await(secondStarted)
      Vitest.expect(builds).toEqual(['first', 'second'])
      Vitest.expect(releases).toEqual([])

      yield* Deferred.succeed(firstGate, undefined)
      yield* Fiber.join(first)
      yield* Deferred.await(firstReleased)
      Vitest.expect(releases).toEqual(['first'])
      Vitest.expect(second.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(secondGate, undefined)
      yield* Fiber.join(second)
      yield* Deferred.await(secondReleased)
      Vitest.expect(releases).toEqual(['first', 'second'])
    }),
  )

  Vitest.effect('finalizes finite history while the live subscription is still open', () =>
    Effect.gen(function* () {
      const { layer, ended } = makeRecordingTracer()
      const finalized = yield* Deferred.make<ReadonlyArray<string>>()
      const live = yield* Deferred.make<void>()
      const observability = makeObservability(
        Layer.mergeAll(layer, Layer.effectDiscard(Effect.addFinalizer(() => Deferred.succeed(finalized, [...ended])))),
      )
      const fiber = yield* Stream.make('history').pipe(
        Stream.withSpan('pull-history'),
        observability.stream,
        Stream.concat(Stream.fromEffect(Deferred.succeed(live, undefined)).pipe(Stream.concat(Stream.never))),
        Stream.runDrain,
        Effect.forkChild,
      )
      yield* Effect.addFinalizer(() => Fiber.interrupt(fiber))
      yield* Deferred.await(live)
      Vitest.expect(yield* Deferred.await(finalized)).toContain('pull-history')
      Vitest.expect(fiber.pollUnsafe()).toBeUndefined()
    }),
  )

  Vitest.effect('ends WebSocket telemetry before the production handler enters its live tail', () =>
    Effect.gen(function* () {
      const { layer, ended } = makeRecordingTracer()
      const finalized = yield* Deferred.make<void>()
      const observability = makeObservability(
        Layer.mergeAll(layer, Layer.effectDiscard(Effect.addFinalizer(() => Deferred.succeed(finalized, undefined)))),
      )
      const input = makeDoInput()
      const handlers = makeRpcHandlers({ ...input, observability }).pipe(
        Layer.provide(Layer.succeed(WsContext, WsContext.of({ ws: makeWebSocket() }))),
      )
      const client = yield* RpcTest.makeClient(SyncWsRpc).pipe(Effect.provide(handlers))
      const pullFiber = yield* client['SyncWsRpc.Pull']({
        storeId: 'store',
        cursor: Option.none(),
        live: true,
      }).pipe(Stream.runDrain, Effect.forkChild)
      yield* Effect.addFinalizer(() => Fiber.interrupt(pullFiber))

      yield* Deferred.await(finalized).pipe(Effect.timeout('1 second'))
      Vitest.expect(ended).toContain('RpcServer.SyncWsRpc.Pull')
      Vitest.expect(pullFiber.pollUnsafe()).toBeUndefined()
    }),
  )

  Vitest.effect('installs telemetry inside the Durable Object RPC stream runtime', () =>
    Effect.gen(function* () {
      const { layer, ended } = makeRecordingTracer()
      const observability = makeObservability(layer)
      const input = makeDoInput()
      const protocol = layerProtocolDurableObject({
        callerContext: { bindingName: 'TEST', durableObjectId: 'client' },
        callRpc: (payload) =>
          createDoRpcHandler({
            // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- Effect RPC owns this ArrayBuffer-backed payload.
            payload: payload as Uint8Array<ArrayBuffer>,
            input,
            observability,
          }).pipe(Effect.runPromise),
      })
      const responses = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(SyncDoRpc)
        return yield* client['SyncDoRpc.Pull']({ storeId: 'store', cursor: Option.none() }).pipe(Stream.runCollect)
      }).pipe(Effect.provide(protocol))

      Vitest.expect(responses).toHaveLength(1)
      Vitest.expect(ended).toContain('RpcServer.SyncDoRpc.Pull')
    }),
  )

  Vitest.effect('attaches a finite span to a sampled caller across an unexported RPC envelope', () =>
    Effect.gen(function* () {
      const { layer, spans, ended } = makeRecordingTracer()
      const observability = makeObservability(layer)
      const caller = Tracer.externalSpan({ traceId: '1'.repeat(32), spanId: '2222222222222222', sampled: true })
      yield* Effect.flatMap(rpcSpanOptions, (options) =>
        withRpcSpan(Effect.void.pipe(Effect.withSpan('push')), 'finite-rpc', options),
      ).pipe(observability.effect, Effect.withSpan('unexported-rpc-envelope'), Effect.withParentSpan(caller))

      Vitest.expect(spans.get('finite-rpc')?.parentId).toBe(caller.spanId)
      Vitest.expect(spans.get('push')?.parentId).toBe(spans.get('finite-rpc')?.spanId)
      Vitest.expect(ended).toEqual(['push', 'finite-rpc'])
    }),
  )

  Vitest.effect('starts a backend root when the RPC caller is unsampled', () =>
    Effect.gen(function* () {
      const { layer, spans, ended } = makeRecordingTracer()
      const observability = makeObservability(layer)
      const caller = Tracer.externalSpan({ traceId: '1'.repeat(32), spanId: '2222222222222222', sampled: false })
      yield* Effect.flatMap(rpcSpanOptions, (options) => withRpcSpan(Effect.void, 'finite-rpc', options)).pipe(
        observability.effect,
        Effect.withSpan('unexported-rpc-envelope'),
        Effect.withParentSpan(caller),
      )

      Vitest.expect(spans.get('finite-rpc')?.parentId).toBeUndefined()
      Vitest.expect(ended).toEqual(['finite-rpc'])
    }),
  )

  Vitest.effect('keeps anticipated RPC recovery failures out of boundary error telemetry', () =>
    Effect.gen(function* () {
      const { layer, statuses } = makeRecordingTracer()
      const observability = makeObservability(layer)
      const expected = new BackendIdMismatchError({ expected: 'backend-a', received: 'backend-b' })
      const unexpected = new UnknownError({ cause: new Error('boom') })

      const effectError = yield* withRpcSpan(Effect.fail(expected), 'expected-effect').pipe(
        observability.effect,
        Effect.flip,
      )
      const streamError = yield* Stream.fail(expected).pipe(
        (_) => withRpcStreamSpan(_, 'expected-stream'),
        observability.stream,
        Stream.runDrain,
        Effect.flip,
      )
      const unexpectedError = yield* withRpcSpan(Effect.fail(unexpected), 'unexpected-effect').pipe(
        observability.effect,
        Effect.flip,
      )

      Vitest.expect(effectError).toBe(expected)
      Vitest.expect(streamError).toBe(expected)
      Vitest.expect(unexpectedError).toBe(unexpected)
      Vitest.expect(statuses.get('expected-effect')).toBe(SpanStatusCode.OK)
      Vitest.expect(statuses.get('expected-stream')).toBe(SpanStatusCode.OK)
      Vitest.expect(statuses.get('unexpected-effect')).toBe(SpanStatusCode.ERROR)
    }),
  )

  Vitest.effect('forwards the operation exit to supplied layer finalizers', () =>
    Effect.gen(function* () {
      const released = yield* Deferred.make<string>()
      const expected = new BackendIdMismatchError({ expected: 'backend-a', received: 'backend-b' })
      const observability = makeObservability(
        Layer.effectDiscard(
          Effect.acquireRelease(Effect.void, (_, exit) => Deferred.succeed(released, exit._tag).pipe(Effect.asVoid)),
        ),
      )

      const error = yield* Effect.fail(expected).pipe(observability.effect, Effect.flip)

      Vitest.expect(error).toBe(expected)
      Vitest.expect(yield* Deferred.await(released)).toBe('Failure')
    }),
  )

  Vitest.live('acknowledges before the owned OTLP collector responds', () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      const acknowledged = yield* Deferred.make<void>()
      const fetch: typeof globalThis.fetch = Vitest.vi.fn(() => {
        started.resolve()
        return gate.promise.then(() => new Response('{}', { headers: { 'content-type': 'application/json' } }))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const observability = makeObservability({ baseUrl: 'http://collector.invalid' })
      yield* Effect.void.pipe(
        Effect.withSpan('push'),
        observability.effect,
        Effect.andThen(Deferred.succeed(acknowledged, undefined)),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
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
  const statuses = new Map<string, SpanStatusCode>()
  const spans = new Map<string, { spanId: string; parentId: string | undefined }>()
  let nextId = 0
  Vitest.vi.spyOn(tracer, 'startSpan').mockImplementation((name, _options, context) => {
    const spanId = (++nextId).toString(16).padStart(16, '0')
    spans.set(name, { spanId, parentId: trace.getSpanContext(context ?? ROOT_CONTEXT)?.spanId })
    const noopSpan = makeNoopSpan()
    return {
      ...noopSpan,
      spanContext: () => ({ traceId: '1'.repeat(32), spanId, traceFlags: 1 }),
      setStatus: (status: SpanStatus) => {
        statuses.set(name, status.code)
        return noopSpan
      },
      end: () => {
        ended.push(name)
      },
    }
  })
  const layer = OtelTracer.layerWithoutOtelTracer.pipe(Layer.provide(Layer.succeed(OtelTracer.OtelTracer, tracer)))
  return { layer, ended, spans, statuses }
}

/** Minimal empty SQLite-backed Durable Object boundary for transport composition tests. */
const makeDoInput = (): Omit<DoCtx.DoCtxInput, 'from'> => {
  const emptyCursor = Object.assign([], { toArray: () => [] })
  const doSelf = {
    env: {},
    ctx: {
      storage: {
        sql: { exec: () => emptyCursor },
        kv: { get: () => undefined, put: () => undefined, delete: () => undefined },
        deleteAll: async () => undefined,
      },
    },
  }

  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- The test intentionally stubs the narrow Worker APIs reached by an empty pull.
  return { doSelf: doSelf as unknown as DoCtx.DoCtxInput['doSelf'], doOptions: undefined }
}

const makeWebSocket = (): CfTypes.WebSocket => {
  const attachment = Schema.encodeSync(WebSocketAttachmentSchema)({ storeId: 'store', pullRequestIds: [] })
  const ws = { deserializeAttachment: () => attachment, close: Vitest.vi.fn() }

  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- The handler only reads the attachment and closes invalid sockets.
  return ws as unknown as CfTypes.WebSocket
}
