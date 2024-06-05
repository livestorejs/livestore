import { shouldNeverHappen } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Deferred, Effect, Queue, Schema, Stream } from '@livestore/utils/effect'

import { WSMessage } from './index.js'
import type { SyncImpl } from './sync.js'

export const makeWsSync = (wsBaseUrl: string, roomId: string): Effect.Effect<SyncImpl, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wsUrl = `${wsBaseUrl}/websocket?room=${roomId}`
    const ws = new WebSocket(wsUrl)

    const pullResQueue = yield* Queue.unbounded<WSMessage.PullRes>().pipe(Effect.acquireRelease(Queue.shutdown))
    const pushBroadcastQueue = yield* Queue.unbounded<WSMessage.PushBroadcast>().pipe(
      Effect.acquireRelease(Queue.shutdown),
    )
    const pushAckQueue = yield* Queue.unbounded<WSMessage.PushAck>().pipe(Effect.acquireRelease(Queue.shutdown))

    const messageHandler = (event: MessageEvent<any>): void => {
      const decodedEventRes = Schema.decodeUnknownEither(WSMessage.Message)(JSON.parse(event.data))

      if (decodedEventRes._tag === 'Left') {
        console.error('Sync: Invalid message received', decodedEventRes.left)
        return
      } else {
        switch (decodedEventRes.right._tag) {
          case 'WSMessage.PullRes': {
            Queue.unsafeOffer(pullResQueue, decodedEventRes.right)

            break
          }
          case 'WSMessage.PushBroadcast': {
            Queue.unsafeOffer(pushBroadcastQueue, decodedEventRes.right)

            break
          }
          case 'WSMessage.PushAck': {
            Queue.offer(pushAckQueue, decodedEventRes.right).pipe(Effect.tapCauseLogPretty, Effect.runSync)

            break
          }
          default: {
            shouldNeverHappen(`Sync: Invalid message received: ${decodedEventRes.right._tag}`)
          }
        }
      }
    }

    ws.addEventListener('message', messageHandler)

    yield* Effect.addFinalizer(() => Effect.sync(() => ws.removeEventListener('message', messageHandler)))

    const wsReady = yield* Deferred.make<void>()

    ws.addEventListener('open', () => {
      Effect.runSync(Deferred.succeed(wsReady, void 0))
      // ws.send(
      //   Schema.encodeSync(Schema.parseJson(WSMessage.InitReq))(
      //     WSMessage.InitReq.make({ _tag: 'WSMessage.InitReq', cursor }),
      //   ),
      // )
    })

    const api = {
      pull: (cursor) =>
        Effect.gen(function* () {
          yield* Deferred.await(wsReady)

          ws.send(
            Schema.encodeSync(Schema.parseJson(WSMessage.PullReq))(
              WSMessage.PullReq.make({ _tag: 'WSMessage.PullReq', cursor }),
            ),
          )

          return Stream.fromQueue(pullResQueue).pipe(
            Stream.takeUntil((_) => _.hasMore === false),
            Stream.map((_) => _.events),
            Stream.flattenIterables,
          )
        }).pipe(Stream.unwrap),
      pushes: Stream.fromQueue(pushBroadcastQueue).pipe(Stream.map((_) => _.mutationEventEncoded)),
      push: (mutationEventEncoded) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>()

          Stream.fromQueue(pushAckQueue).pipe(
            Stream.filter((_) => _.mutationId === mutationEventEncoded.id),
            Stream.take(1),
            Stream.tap(() => Deferred.succeed(ready, void 0)),
            Stream.runDrain,
            Effect.tapCauseLogPretty,
            Effect.runFork,
          )

          ws.send(
            Schema.encodeSync(Schema.parseJson(WSMessage.Message))(
              WSMessage.PushReq.make({ _tag: 'WSMessage.PushReq', mutationEventEncoded }),
            ),
          )

          yield* Deferred.await(ready)
        }),
    } satisfies SyncImpl

    return api
  })
