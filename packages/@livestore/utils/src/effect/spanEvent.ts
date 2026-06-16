import { Effect, Logger } from 'effect'

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
  Effect.provideService(
    Effect.log(message).pipe(Effect.annotateLogs(attributes ?? {})),
    Logger.CurrentLoggers,
    new Set([Logger.tracerLogger]),
  )
