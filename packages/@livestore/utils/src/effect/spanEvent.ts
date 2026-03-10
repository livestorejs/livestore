import { Effect, FiberRef, HashSet, Logger } from 'effect'

export const spanEvent = (message: any, attributes?: Record<string, unknown>) =>
  Effect.locallyWith(Effect.log(message).pipe(Effect.annotateLogs(attributes ?? {})), FiberRef.currentLoggers, () =>
    HashSet.make(Logger.tracerLogger),
  )
