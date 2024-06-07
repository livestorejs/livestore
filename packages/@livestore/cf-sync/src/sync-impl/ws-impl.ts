/// <reference lib="dom" />

import type { SyncImpl } from '@livestore/common'
import { cuid } from '@livestore/utils/cuid'
import type { Scope } from '@livestore/utils/effect'
import { Deferred, Effect, PubSub, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { WSMessage } from '../common/index.js'

export const makeWsSync = (wsBaseUrl: string, roomId: string): Effect.Effect<SyncImpl, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wsUrl = `${wsBaseUrl}/websocket?room=${roomId}`

    const { isConnected, incomingMessages, send } = yield* connect(wsUrl)

    const api = {
      isConnected,
      pull: (cursor) =>
        Effect.gen(function* () {
          const requestId = cuid()

          yield* send(WSMessage.PullReq.make({ _tag: 'WSMessage.PullReq', cursor, requestId }))

          return Stream.fromPubSub(incomingMessages).pipe(
            Stream.filter(Schema.is(WSMessage.PullRes)),
            Stream.filter((_) => _.requestId === requestId),
            Stream.takeUntil((_) => _.hasMore === false),
            Stream.map((_) => _.events),
            Stream.flattenIterables,
          )
        }).pipe(Stream.unwrap),
      pushes: Stream.fromPubSub(incomingMessages).pipe(
        Stream.filter(Schema.is(WSMessage.PushBroadcast)),
        Stream.map((_) => _.mutationEventEncoded),
      ),
      push: (mutationEventEncoded) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>()
          const requestId = cuid()

          yield* Stream.fromPubSub(incomingMessages).pipe(
            Stream.filter(Schema.is(WSMessage.PushAck)),
            Stream.filter((_) => _.requestId === requestId),
            Stream.filter((_) => _.mutationId === mutationEventEncoded.id),
            Stream.take(1),
            Stream.tap(() => Deferred.succeed(ready, void 0)),
            Stream.runDrain,
            Effect.tapCauseLogPretty,
            Effect.fork,
          )

          yield* send(WSMessage.PushReq.make({ _tag: 'WSMessage.PushReq', mutationEventEncoded, requestId }))

          yield* Deferred.await(ready)
        }),
    } satisfies SyncImpl

    return api
  })

const connect = (wsUrl: string) =>
  Effect.gen(function* () {
    const isConnected = yield* SubscriptionRef.make(false)
    const wsRef: { current: WebSocket | undefined } = { current: undefined }

    const incomingMessages = yield* PubSub.unbounded<Exclude<WSMessage.IncomingMessage, WSMessage.Pong>>()

    const waitUntilOnline = isConnected.changes.pipe(Stream.filter(Boolean), Stream.take(1), Stream.runDrain)

    const send = (message: WSMessage.Message) =>
      Effect.gen(function* () {
        // Wait first until we're online
        if ((yield* SubscriptionRef.get(isConnected)) === false) {
          yield* waitUntilOnline
        }

        wsRef.current!.send(Schema.encodeSync(Schema.parseJson(WSMessage.Message))(message))
      })

    const innerConnect = Effect.gen(function* () {
      // If the browser already tells us we're offline, then we'll at least wait until the browser
      // thinks we're online again. (We'll only know for sure once the WS conneciton is established.)
      if (navigator.onLine === false) {
        yield* Effect.async((cb) => self.addEventListener('online', () => cb(Effect.void)))
      }

      const ws = new WebSocket(wsUrl)
      const connectionClosed = yield* Deferred.make<void>()

      const pongMessages = yield* Queue.unbounded<WSMessage.Pong>()

      const messageHandler = (event: MessageEvent<any>): void => {
        const decodedEventRes = Schema.decodeUnknownEither(Schema.parseJson(WSMessage.IncomingMessage))(event.data)

        if (decodedEventRes._tag === 'Left') {
          console.error('Sync: Invalid message received', decodedEventRes.left)
          return
        } else {
          if (decodedEventRes.right._tag === 'WSMessage.Pong') {
            Queue.offer(pongMessages, decodedEventRes.right).pipe(Effect.runSync)
          } else {
            PubSub.publish(incomingMessages, decodedEventRes.right).pipe(Effect.runSync)
          }
        }
      }

      ws.addEventListener('message', messageHandler)

      ws.addEventListener('open', () => {
        wsRef.current = ws
        SubscriptionRef.set(isConnected, true).pipe(Effect.runSync)
      })

      ws.addEventListener('close', () => {
        Deferred.succeed(connectionClosed, void 0).pipe(Effect.runSync)
      })

      ws.addEventListener('error', () => {
        ws.close()
        Deferred.succeed(connectionClosed, void 0).pipe(Effect.runSync)
      })

      yield* Effect.addFinalizer(() => Effect.sync(() => ws.removeEventListener('message', messageHandler)))

      const checkPingPong = Effect.gen(function* () {
        yield* send({ _tag: 'WSMessage.Ping', requestId: 'ping' })

        // NOTE those numbers might need more fine-tuning to allow for bad network conditions
        yield* Queue.take(pongMessages).pipe(Effect.timeout(2000))

        yield* Effect.sleep(5000)
      })

      yield* waitUntilOnline.pipe(
        Effect.andThen(checkPingPong.pipe(Effect.forever)),
        Effect.tapErrorCause(() => Deferred.succeed(connectionClosed, void 0)),
        Effect.forkScoped,
      )

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          wsRef.current = undefined
          yield* SubscriptionRef.set(isConnected, false)
        }),
      )

      yield* Deferred.await(connectionClosed)
    })

    yield* innerConnect.pipe(Effect.forever, Effect.tapCauseLogPretty, Effect.forkScoped)

    return { isConnected, incomingMessages, send }
  })
