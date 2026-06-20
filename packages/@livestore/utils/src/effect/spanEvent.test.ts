import { describe, expect, it } from '@effect/vitest'
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
    span(options) {
      const events: Array<RecordedEvent> = []
      spanEvents.set(options.name, events)
      const attributes = new Map<string, unknown>()
      return {
        _tag: 'Span' as const,
        name: options.name,
        spanId: `test-${options.name}`,
        traceId: 'test-trace',
        parent: options.parent,
        annotations: options.annotations,
        status: { _tag: 'Started' as const, startTime: options.startTime },
        attributes,
        links: options.links,
        sampled: true,
        kind: options.kind,
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
      expect(events).toHaveLength(1)
      expect(events[0]!.name).toBe('test-event')
    }).pipe(Effect.withSpan('test-span'), Effect.withTracer(tracer))
  })

  it.effect('should emit a span event with attributes', () => {
    const { tracer, getEvents } = makeTestTracer()
    return Effect.gen(function* () {
      yield* spanEvent('event-with-attrs', { key1: 'value1', key2: 42 })
      const events = getEvents('test-span')
      expect(events).toHaveLength(1)
      expect(events[0]!.name).toBe('event-with-attrs')
      expect(events[0]!.attributes).toMatchObject({ key1: 'value1', key2: 42 })
    }).pipe(Effect.withSpan('test-span'), Effect.withTracer(tracer))
  })

  it.effect('should emit to the nearest enclosing span', () => {
    const { tracer, getEvents } = makeTestTracer()
    return Effect.gen(function* () {
      yield* spanEvent('outer-event')

      yield* spanEvent('inner-event').pipe(Effect.withSpan('inner-span'))

      const outerEvents = getEvents('outer-span')
      const innerEvents = getEvents('inner-span')

      expect(outerEvents).toHaveLength(1)
      expect(outerEvents[0]!.name).toBe('outer-event')

      expect(innerEvents).toHaveLength(1)
      expect(innerEvents[0]!.name).toBe('inner-event')
    }).pipe(Effect.withSpan('outer-span'), Effect.withTracer(tracer))
  })

  it.effect('should be a no-op when no span is in context', () => spanEvent('orphan-event'))
})
