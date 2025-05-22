import type { ParseResult, Scope, WebChannel } from '@livestore/utils/effect'
import {
  Data,
  Duration,
  Effect,
  FiberMap,
  HashSet,
  Schedule,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'

export const RequestSessions = Schema.TaggedStruct('RequestSessions', {})
export type RequestSessions = typeof RequestSessions.Type

export const SessionInfo = Schema.TaggedStruct('SessionInfo', {
  storeId: Schema.String,
  clientId: Schema.String,
  sessionId: Schema.String,
  schemaAlias: Schema.String,
  isLeader: Schema.Boolean,
})
export type SessionInfo = typeof SessionInfo.Type

export const Message = Schema.Union(RequestSessions, SessionInfo)
export type Message = typeof Message.Type

/** Usually called in client session */
export const provideSessionInfo = ({
  webChannel,
  sessionInfo,
}: {
  webChannel: WebChannel.WebChannel<Message, Message>
  sessionInfo: SessionInfo
}): Effect.Effect<void, ParseResult.ParseError> =>
  Effect.gen(function* () {
    yield* webChannel.send(sessionInfo)

    yield* webChannel.listen.pipe(
      Stream.flatten(),
      Stream.filter(Schema.is(RequestSessions)),
      Stream.tap(() => webChannel.send(sessionInfo)),
      Stream.runDrain,
    )
  })

/** Usually called in devtools */
export const requestSessionInfoSubscription = ({
  webChannel,
  pollInterval = Duration.seconds(1),
  staleTimeout = Duration.seconds(5),
}: {
  webChannel: WebChannel.WebChannel<Message, Message>
  pollInterval?: Duration.DurationInput
  staleTimeout?: Duration.DurationInput
}): Effect.Effect<Subscribable.Subscribable<Set<SessionInfo>>, ParseResult.ParseError, Scope.Scope> =>
  Effect.gen(function* () {
    yield* webChannel
      .send(RequestSessions.make({}))
      .pipe(
        Effect.repeat(Schedule.spaced(pollInterval)),
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

    const timeoutFiberMap = yield* FiberMap.make<SessionInfo>()

    const sessionInfoSubRef = yield* SubscriptionRef.make<HashSet.HashSet<SessionInfo>>(HashSet.empty())

    yield* webChannel.listen.pipe(
      Stream.flatten(),
      Stream.filter(Schema.is(SessionInfo)),
      Stream.map(Data.struct),
      Stream.tap(
        Effect.fn(function* (sessionInfo) {
          yield* SubscriptionRef.getAndUpdate(sessionInfoSubRef, HashSet.add(sessionInfo))

          // Remove sessionInfo from cache after staleTimeout (unless a new identical item resets the timeout)
          yield* FiberMap.run(
            timeoutFiberMap,
            sessionInfo,
            Effect.gen(function* () {
              yield* Effect.sleep(staleTimeout)
              yield* SubscriptionRef.getAndUpdate(sessionInfoSubRef, HashSet.remove(sessionInfo))
            }),
          )
        }),
      ),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    return Subscribable.make({
      get: sessionInfoSubRef.get.pipe(Effect.map((sessionInfos) => new Set(sessionInfos))),
      changes: sessionInfoSubRef.changes.pipe(Stream.map((sessionInfos) => new Set(sessionInfos))),
    })
  })
