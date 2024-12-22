/// <reference lib="dom" />

import type { SyncBackend, SyncBackendOptionsBase } from '@livestore/common'
import { InvalidPullError, InvalidPushError } from '@livestore/common'
import type { Scope } from '@livestore/utils/effect'
import {
  Deferred,
  Effect,
  Option,
  PubSub,
  Queue,
  Schedule,
  Schema,
  Stream,
  SubscriptionRef,
  WebSocket,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { WSMessage } from '../common/index.js'

export interface WsSyncOptions extends SyncBackendOptionsBase {
  type: 'cf'
  url: string
  roomId: string
}

interface LiveStoreGlobalCf {
  syncBackend: WsSyncOptions
}

declare global {
  interface LiveStoreGlobal extends LiveStoreGlobalCf {}
}

export const makeWsSync = (options: WsSyncOptions): Effect.Effect<SyncBackend<null>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wsUrl = `${options.url}/websocket?room=${options.roomId}`

    const { isConnected, incomingMessages, send } = yield* connect(wsUrl)

    const metadata = Option.none()

    const api = {
      isConnected,
      pull: (args, { listenForNew }) =>
        listenForNew
          ? Effect.gen(function* () {
              const requestId = nanoid()
              const cursor = Option.getOrUndefined(args)?.cursor.global

              yield* send(WSMessage.PullReq.make({ cursor, requestId }))

              return Stream.fromPubSub(incomingMessages).pipe(
                Stream.filter((_) => (_._tag === 'WSMessage.PullRes' ? _.requestId === requestId : true)),
                Stream.tap((_) =>
                  _._tag === 'WSMessage.Error' ? new InvalidPullError({ message: _.message }) : Effect.void,
                ),
                Stream.filter(Schema.is(Schema.Union(WSMessage.PushBroadcast, WSMessage.PullRes))),
                Stream.map((msg) =>
                  msg._tag === 'WSMessage.PushBroadcast'
                    ? [
                        {
                          mutationEventEncoded: msg.mutationEventEncoded,
                          persisted: msg.persisted,
                          metadata,
                          remaining: 0,
                        },
                      ]
                    : msg.events.map((_, i) => ({
                        mutationEventEncoded: _,
                        metadata,
                        persisted: true,
                        remaining: msg.remaining - i,
                      })),
                ),
                Stream.flattenIterables,
              )
            }).pipe(Stream.unwrap)
          : Effect.gen(function* () {
              const requestId = nanoid()
              const cursor = Option.getOrUndefined(args)?.cursor.global

              yield* send(WSMessage.PullReq.make({ cursor, requestId }))

              return Stream.fromPubSub(incomingMessages).pipe(
                Stream.filter((_) => _._tag !== 'WSMessage.PushBroadcast' && _.requestId === requestId),
                Stream.tap((_) =>
                  _._tag === 'WSMessage.Error' ? new InvalidPullError({ message: _.message }) : Effect.void,
                ),
                Stream.filter(Schema.is(WSMessage.PullRes)),
                Stream.takeUntil((_) => _.remaining === 0),
                Stream.map((_) =>
                  _.events.map((event, i) => ({
                    mutationEventEncoded: event,
                    metadata,
                    persisted: true,
                    remaining: _.remaining - i,
                  })),
                ),
                Stream.flattenIterables,
              )
            }).pipe(Stream.unwrap),
      push: (batch, persisted) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void, InvalidPushError>()
          const requestId = nanoid()

          yield* Stream.fromPubSub(incomingMessages).pipe(
            Stream.filter((_) => _._tag !== 'WSMessage.PushBroadcast' && _.requestId === requestId),
            Stream.tap((_) =>
              _._tag === 'WSMessage.Error'
                ? Deferred.fail(ready, new InvalidPushError({ reason: { _tag: 'Unexpected', message: _.message } }))
                : Effect.void,
            ),
            Stream.filter(Schema.is(WSMessage.PushAck)),
            // TODO bring back filterting of "own events"
            // Stream.filter((_) => _.mutationId === mutationEventEncoded.id.global),
            Stream.take(1),
            Stream.tap(() => Deferred.succeed(ready, void 0)),
            Stream.runDrain,
            Effect.tapCauseLogPretty,
            Effect.fork,
          )

          yield* send(WSMessage.PushReq.make({ batch, requestId, persisted }))

          yield* Deferred.await(ready)

          return { metadata: Array.from({ length: batch.length }, () => metadata) }
        }),
    } satisfies SyncBackend<null>

    return api
  })

const connect = (wsUrl: string) =>
  Effect.gen(function* () {
    const isConnected = yield* SubscriptionRef.make(false)
    const socketRef: { current: globalThis.WebSocket | undefined } = { current: undefined }

    const incomingMessages = yield* PubSub.unbounded<Exclude<WSMessage.BackendToClientMessage, WSMessage.Pong>>().pipe(
      Effect.acquireRelease(PubSub.shutdown),
    )

    const waitUntilOnline = isConnected.changes.pipe(Stream.filter(Boolean), Stream.take(1), Stream.runDrain)

    const send = (message: WSMessage.Message) =>
      Effect.gen(function* () {
        // Wait first until we're online
        yield* waitUntilOnline

        yield* Effect.spanEvent(
          `Sending message: ${message._tag}`,
          message._tag === 'WSMessage.PushReq'
            ? { id: message.batch[0]!.id.global, parentId: message.batch[0]!.parentId.global }
            : message._tag === 'WSMessage.PullReq'
              ? { cursor: message.cursor ?? '-' }
              : {},
        )

        // TODO use MsgPack instead of JSON to speed up the serialization / reduce the size of the messages
        socketRef.current!.send(Schema.encodeSync(Schema.parseJson(WSMessage.Message))(message))
      })

    const innerConnect = Effect.gen(function* () {
      // If the browser already tells us we're offline, then we'll at least wait until the browser
      // thinks we're online again. (We'll only know for sure once the WS conneciton is established.)
      while (typeof navigator !== 'undefined' && navigator.onLine === false) {
        yield* Effect.sleep(1000)
      }
      // if (navigator.onLine === false) {
      //   yield* Effect.async((cb) => self.addEventListener('online', () => cb(Effect.void)))
      // }

      const socket = yield* WebSocket.makeWebSocket({ url: wsUrl, reconnect: Schedule.exponential(100) })

      yield* SubscriptionRef.set(isConnected, true)
      socketRef.current = socket

      const connectionClosed = yield* Deferred.make<void>()

      const pongMessages = yield* Queue.unbounded<WSMessage.Pong>().pipe(Effect.acquireRelease(Queue.shutdown))

      yield* Effect.eventListener(socket, 'message', (event: MessageEvent) =>
        Effect.gen(function* () {
          const decodedEventRes = Schema.decodeUnknownEither(Schema.parseJson(WSMessage.BackendToClientMessage))(
            event.data,
          )

          if (decodedEventRes._tag === 'Left') {
            console.error('Sync: Invalid message received', decodedEventRes.left)
            return
          } else {
            if (decodedEventRes.right._tag === 'WSMessage.Pong') {
              yield* Queue.offer(pongMessages, decodedEventRes.right)
            } else {
              yield* Effect.log(`decodedEventRes: ${decodedEventRes.right._tag}`)
              yield* PubSub.publish(incomingMessages, decodedEventRes.right)
            }
          }
        }),
      )

      yield* Effect.eventListener(socket, 'close', () => Deferred.succeed(connectionClosed, void 0))

      yield* Effect.eventListener(socket, 'error', () =>
        Effect.gen(function* () {
          socket.close(3000, 'Sync: WebSocket error')
          yield* Deferred.succeed(connectionClosed, void 0)
        }),
      )

      // NOTE it seems that this callback doesn't work reliably on a worker but only via `window.addEventListener`
      // We might need to proxy the event from the main thread to the worker if we want this to work reliably.
      // eslint-disable-next-line unicorn/prefer-global-this
      if (typeof self !== 'undefined') {
        // eslint-disable-next-line unicorn/prefer-global-this
        yield* Effect.eventListener(self, 'offline', () => Deferred.succeed(connectionClosed, void 0))
      }

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          socketRef.current = undefined
          yield* SubscriptionRef.set(isConnected, false)
        }),
      )

      const checkPingPong = Effect.gen(function* () {
        // TODO include pong latency infomation in network status
        yield* send({ _tag: 'WSMessage.Ping', requestId: 'ping' })

        // NOTE those numbers might need more fine-tuning to allow for bad network conditions
        yield* Queue.take(pongMessages).pipe(Effect.timeout(5000))

        yield* Effect.sleep(25_000)
      }).pipe(Effect.withSpan('@livestore/sync-cf:connect:checkPingPong'))

      yield* waitUntilOnline.pipe(
        Effect.andThen(checkPingPong.pipe(Effect.forever)),
        Effect.tapErrorCause(() => Deferred.succeed(connectionClosed, void 0)),
        Effect.forkScoped,
      )

      yield* Deferred.await(connectionClosed)
    }).pipe(Effect.scoped, Effect.withSpan('@livestore/sync-cf:connect'))

    yield* innerConnect.pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)

    return { isConnected, incomingMessages, send }
  })
