import { InvalidPullError, InvalidPushError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import { Effect, Layer, Mailbox, MutableRef, ReadonlyArray, Stream } from '@livestore/utils/effect'
import { SyncRpcGroup } from '../shared.ts'
import { EventStorage } from './event-storage.ts'
import { StoreLookup, StorePubSub } from './store-lookup.ts'

export const SyncHandlers = SyncRpcGroup.toLayer(
  Effect.gen(function* () {
    const lookup = yield* StoreLookup

    return SyncRpcGroup.of({
      push: Effect.fnUntraced(
        function* ({ batch }) {
          const storage = yield* EventStorage
          const pubsub = yield* StorePubSub
          yield* storage.push(batch)
          yield* pubsub.publish(ReadonlyArray.lastNonEmpty(batch).seqNum)
        },
        Effect.mapError((cause) => new InvalidPushError({ cause })),
        (effect, { storeId }) => Effect.provide(effect, lookup.get(storeId)),
      ),
      pull: Effect.fnUntraced(
        function* ({ cursor, live }) {
          const mailbox = yield* Mailbox.make<
            ReadonlyArray.NonEmptyReadonlyArray<LiveStoreEvent.Global.Encoded>,
            InvalidPullError
          >()
          const storage = yield* EventStorage

          if (!live) {
            const events = yield* storage.pull(cursor).pipe(Effect.mapError((cause) => new InvalidPullError({ cause })))
            if (ReadonlyArray.isNonEmptyReadonlyArray(events)) {
              mailbox.unsafeOffer(events)
            }
            yield* mailbox.end
            return mailbox
          }

          const pubsub = yield* StorePubSub
          const currentSequence = MutableRef.make(cursor)

          yield* pubsub.subscribe.pipe(
            Stream.merge(Stream.succeed(cursor + 1)),
            Stream.mapEffect((latestSeq) => {
              if (latestSeq <= currentSequence.current) {
                return Effect.void
              }
              return Effect.flatMap(storage.pull(currentSequence.current), (events) => {
                if (!ReadonlyArray.isNonEmptyReadonlyArray(events)) {
                  return Effect.void
                }
                const last = ReadonlyArray.lastNonEmpty(events)
                currentSequence.current = last.seqNum
                return mailbox.offer(events)
              })
            }),
            Stream.runDrain,
            Effect.mapError((cause) => new InvalidPullError({ cause })),
            Mailbox.into(mailbox),
            Effect.forkScoped,
          )

          return mailbox
        },
        (effect, { storeId }) => Effect.provide(effect, lookup.get(storeId)),
      ),
      backendId: Effect.fnUntraced(
        function* (_) {
          const storage = yield* EventStorage
          return yield* storage.backendId
        },
        (effect, { storeId }) => Effect.provide(effect, lookup.get(storeId)),
      ),
      ping: (_) => Effect.void,
    })
  }),
).pipe(Layer.provide(StoreLookup.Default))
