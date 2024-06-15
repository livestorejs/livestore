/// <reference lib="dom" />

import type { SyncImpl } from '@livestore/common'
import { InvalidPullError, InvalidPushError } from '@livestore/common'
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

          yield* send(WSMessage.PullReq.make({ cursor, requestId }))

          return Stream.fromPubSub(incomingMessages).pipe(
            Stream.filter((_) => _.requestId === requestId),
            Stream.tap((_) =>
              _._tag === 'WSMessage.Error' ? new InvalidPullError({ message: _.message }) : Effect.void,
            ),
            Stream.filter(Schema.is(WSMessage.PullRes)),
            Stream.takeUntil((_) => _.hasMore === false),
            Stream.map((_) => _.events),
            Stream.flattenIterables,
          )
        }).pipe(Stream.unwrap),
      pushes: Stream.fromPubSub(incomingMessages).pipe(
        Stream.filter(Schema.is(WSMessage.PushBroadcast)),
        Stream.map((_) => ({ mutationEventEncoded: _.mutationEventEncoded, persisted: _.persisted })),
      ),
      push: (mutationEventEncoded, persisted) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void, InvalidPushError>()
          const requestId = cuid()

          yield* Stream.fromPubSub(incomingMessages).pipe(
            Stream.filter((_) => _.requestId === requestId),
            Stream.tap((_) =>
              _._tag === 'WSMessage.Error'
                ? Deferred.fail(ready, new InvalidPushError({ message: _.message }))
                : Effect.void,
            ),
            Stream.filter(Schema.is(WSMessage.PushAck)),
            Stream.filter((_) => _.mutationId === mutationEventEncoded.id),
            Stream.take(1),
            Stream.tap(() => Deferred.succeed(ready, void 0)),
            Stream.runDrain,
            Effect.tapCauseLogPretty,
            Effect.fork,
          )

          yield* send(WSMessage.PushReq.make({ mutationEventEncoded, requestId, persisted }))

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

    const waitUntilOnline = SubscriptionRef.changeStreamIncludingCurrent(isConnected).pipe(
      Stream.filter(Boolean),
      Stream.take(1),
      Stream.runDrain,
    )

    const send = (message: WSMessage.Message) =>
      Effect.gen(function* () {
        // Wait first until we're online
        yield* waitUntilOnline

        wsRef.current!.send(Schema.encodeSync(Schema.parseJson(WSMessage.Message))(message))
      })

    const innerConnect = Effect.gen(function* () {
      // If the browser already tells us we're offline, then we'll at least wait until the browser
      // thinks we're online again. (We'll only know for sure once the WS conneciton is established.)
      while (navigator.onLine === false) {
        yield* Effect.sleep(1000)
      }
      // if (navigator.onLine === false) {
      //   yield* Effect.async((cb) => self.addEventListener('online', () => cb(Effect.void)))
      // }

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

      const offlineHandler = () => {
        Deferred.succeed(connectionClosed, void 0).pipe(Effect.runSync)
      }

      // NOTE it seems that this callback doesn't work reliably on a worker but only via `window.addEventListener`
      // We might need to proxy the event from the main thread to the worker if we want this to work reliably.
      self.addEventListener('offline', offlineHandler)

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          ws.removeEventListener('message', messageHandler)
          self.removeEventListener('offline', offlineHandler)
          wsRef.current?.close()
          wsRef.current = undefined
          yield* SubscriptionRef.set(isConnected, false)
        }),
      )

      ws.addEventListener('message', messageHandler)

      if (ws.readyState === WebSocket.OPEN) {
        wsRef.current = ws
        SubscriptionRef.set(isConnected, true).pipe(Effect.runSync)
      } else {
        ws.addEventListener('open', () => {
          wsRef.current = ws
          SubscriptionRef.set(isConnected, true).pipe(Effect.runSync)
        })
      }

      ws.addEventListener('close', () => {
        Deferred.succeed(connectionClosed, void 0).pipe(Effect.runSync)
      })

      ws.addEventListener('error', () => {
        ws.close()
        Deferred.succeed(connectionClosed, void 0).pipe(Effect.runSync)
      })

      const checkPingPong = Effect.gen(function* () {
        // TODO include pong latency infomation in network status
        yield* send({ _tag: 'WSMessage.Ping', requestId: 'ping' })

        // NOTE those numbers might need more fine-tuning to allow for bad network conditions
        yield* Queue.take(pongMessages).pipe(Effect.timeout(5000))

        yield* Effect.sleep(25_000)
      })

      yield* waitUntilOnline.pipe(
        Effect.andThen(checkPingPong.pipe(Effect.forever)),
        Effect.tapErrorCause(() => Deferred.succeed(connectionClosed, void 0)),
        Effect.forkScoped,
      )

      yield* Deferred.await(connectionClosed)
    }).pipe(Effect.scoped)

    yield* innerConnect.pipe(Effect.forever, Effect.tapCauseLogPretty, Effect.forkScoped)

    return { isConnected, incomingMessages, send }
  })
