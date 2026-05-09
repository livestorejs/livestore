import { assert, describe, it } from '@effect/vitest'
import { Effect, Tracer } from 'effect'

import { spanEvent } from './spanEvent.ts'

type RecordedEvent = { name: string; attributes: Record<string, unknown> | undefined }

/**
 * Creates a test tracer that captures span events for assertion,
 * using only the public `Tracer` API (no internal NativeSpan access).
 * Each span records its own events, retrievable by span name.
 */
const makeTestTracer = () => {
  const spanEvents = new Map<string, Array<RecordedEvent>>()

  const tracer = Tracer.make({
    span({ name, parent, annotations, links, startTime, kind }) {
      const events: Array<RecordedEvent> = []
      spanEvents.set(name, events)
      const attributes = new Map<string, unknown>()
      return {
        _tag: 'Span' as const,
        name,
        spanId: `test-${name}`,
        traceId: 'test-trace',
        parent,
        annotations,
        status: { _tag: 'Started' as const, startTime },
        attributes,
        links: [...links],
        sampled: true,
        kind,
        end() {},
        attribute(key: string, value: unknown) {
          attributes.set(key, value)
        },
        event(eventName: string, _startTime: bigint, attrs?: Record<string, unknown>) {
          events.push({ name: eventName, attributes: attrs })
        },
        addLinks() {},
      }
    },
    context(primitive, fiber) {
      return (primitive as any)['~effect/Effect/evaluate'](fiber)
    },
  })

  return {
    tracer,
    getEvents: (spanName: string): Array<RecordedEvent> => spanEvents.get(spanName) ?? [],
  }
}

describe('spanEvent', () => {
  it.effect('should emit a span event with the given message', () => {
    const { tracer, getEvents } = makeTestTracer()
    return Effect.gen(function* () {
      yield* spanEvent('test-event')
      const events = getEvents('test-span')
      assert.strictEqual(events.length, 1)
      assert.strictEqual(events[0]!.name, 'test-event')
    }).pipe(Effect.withSpan('test-span'), Effect.withTracer(tracer))
  })

  it.effect('should emit a span event with attributes', () => {
    const { tracer, getEvents } = makeTestTracer()
    return Effect.gen(function* () {
      yield* spanEvent('event-with-attrs', { key1: 'value1', key2: 42 })
      const events = getEvents('test-span')
      assert.strictEqual(events.length, 1)
      assert.strictEqual(events[0]!.name, 'event-with-attrs')
      assert.deepStrictEqual(events[0]!.attributes, { key1: 'value1', key2: 42 })
    }).pipe(Effect.withSpan('test-span'), Effect.withTracer(tracer))
  })

  it.effect('should emit to the nearest enclosing span', () => {
    const { tracer, getEvents } = makeTestTracer()
    return Effect.gen(function* () {
      yield* spanEvent('outer-event')

      yield* spanEvent('inner-event').pipe(Effect.withSpan('inner-span'))

      const outerEvents = getEvents('outer-span')
      const innerEvents = getEvents('inner-span')

      assert.strictEqual(outerEvents.length, 1)
      assert.strictEqual(outerEvents[0]!.name, 'outer-event')

      assert.strictEqual(innerEvents.length, 1)
      assert.strictEqual(innerEvents[0]!.name, 'inner-event')
    }).pipe(Effect.withSpan('outer-span'), Effect.withTracer(tracer))
  })

  it.effect('should be a no-op when no span is in context', () => spanEvent('orphan-event'))
})
