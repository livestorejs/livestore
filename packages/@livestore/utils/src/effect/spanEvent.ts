import { Clock, Effect } from 'effect'

/**
 * Emits a span event on the current Effect span via the tracer logger.
 *
 * @remarks
 *
 * Unlike raw `otelSpan.addEvent`, this doesn't require manual span threading —
 * it automatically targets the nearest enclosing `Effect.withSpan`. If no span
 * is in context, the call is a no-op.
 */
export const spanEvent = (message: any, attributes?: Record<string, unknown>) =>
  Effect.gen(function* () {
    const span = yield* Effect.currentSpan
    const now = yield* Clock.currentTimeNanos
    span.event(String(message), now, attributes)
  }).pipe(Effect.catchTag('NoSuchElementError', () => Effect.void))
