import { InvalidPullError, InvalidPushError, UnknownError } from '@livestore/common'
import { Effect, FiberMap, MutableRef, ReadonlyArray, Socket, Stream } from '@livestore/utils/effect'
import { decodePushEventSync, encodePullEventSync, type PullEventFromJson, type PullRequest } from '../shared.ts'
import { EventsRepo } from './events-repo.ts'
import { StoreLookup, StorePubSub } from './store-lookup.ts'

/**
 * Synchronizes events over a Socket for the specified store.
 *
 * Note: It assumes messages are already framed, do not use with raw TCP
 * sockets.
 */
export const syncSocket = Effect.fnUntraced(
  function* (_storeId: string) {
    const socket = yield* Socket.Socket
    const repo = yield* EventsRepo
    const write = yield* socket.writer
    const writePullEvent = (event: typeof PullEventFromJson.Type) => Effect.orDie(write(encodePullEventSync(event)))
    const pullers = yield* FiberMap.make<number>()
    const pubsub = yield* StorePubSub

    const initialPull = (options: typeof PullRequest.Type) =>
      repo.pull(options.cursor).pipe(
        Effect.flatMap((events) => {
          if (!ReadonlyArray.isNonEmptyReadonlyArray(events)) {
            return Effect.void
          }
          return writePullEvent({ _tag: 'Pull', id: options.id, batch: events })
        }),
      )

    const startPull = Effect.fnUntraced(
      function* (options: typeof PullRequest.Type) {
        if (!options.live) {
          return yield* initialPull(options)
        }

        const currentSequence = MutableRef.make(options.cursor)

        yield* Effect.fork(initialPull(options))

        yield* pubsub.subscribe.pipe(
          Stream.flatMap((latestSeq) => {
            if (latestSeq <= currentSequence.current) {
              return Stream.empty
            }
            return repo.pull(currentSequence.current).pipe(
              Effect.map((events) => {
                if (!ReadonlyArray.isNonEmptyReadonlyArray(events)) {
                  return Stream.empty
                }
                const last = ReadonlyArray.lastNonEmpty(events)
                currentSequence.current = last.seqNum
                return Stream.succeed(events)
              }),
              Stream.unwrap,
            )
          }),
          Stream.runForEach((events) => writePullEvent({ _tag: 'Pull', id: options.id, batch: events })),
          Effect.mapError((cause) => new InvalidPullError({ cause: cause.cause })),
          Effect.catchAllCause((cause) => writePullEvent({ _tag: 'PullError', id: options.id, cause })),
        )
      },
      (effect, request) => FiberMap.run(pullers, request.id, effect, { onlyIfMissing: true }),
    )

    const decoder = new TextDecoder()
    yield* socket
      .runRaw((msg) => {
        const text = typeof msg === 'string' ? msg : decoder.decode(msg)
        const pushEvent = decodePushEventSync(text)
        switch (pushEvent._tag) {
          case 'Push': {
            return repo.push(pushEvent.batch).pipe(
              Effect.mapError((cause) => new InvalidPushError({ cause })),
              Effect.exit,
              Effect.flatMap((exit) => writePullEvent({ _tag: 'PushResponse', id: pushEvent.id, exit })),
            )
          }
          case 'PullRequest': {
            return startPull(pushEvent)
          }
          case 'PullCancel': {
            return FiberMap.remove(pullers, pushEvent.id)
          }
          case 'Ping': {
            return writePullEvent({ _tag: 'Pong', id: pushEvent.id })
          }
        }
      })
      .pipe(
        Effect.catchTag(
          'SocketError',
          (_) =>
            new UnknownError({
              cause: new Error('Socket error occurred during sync session'),
            }),
        ),
      )
  },
  (effect, storeId) => Effect.provide(effect, StoreLookup.get(storeId)),
  Effect.scoped,
)
