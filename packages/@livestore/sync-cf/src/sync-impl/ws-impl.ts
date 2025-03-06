/// <reference lib="dom" />

import type { SyncBackend } from '@livestore/common'
import { InvalidPullError, InvalidPushError } from '@livestore/common'
import { EventId } from '@livestore/common/schema'
import { LS_DEV, shouldNeverHappen } from '@livestore/utils'
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

import { WSMessage } from '../common/mod.js'
import type { SyncMetadata } from '../common/ws-message-types.js'

export interface WsSyncOptions {
  url: string
  storeId: string
}

export const makeWsSync = (options: WsSyncOptions): Effect.Effect<SyncBackend<SyncMetadata>, never, Scope.Scope> =>
  Effect.gen(function* () {
    // TODO also allow for auth scenarios
    const wsUrl = `${options.url}/websocket?storeId=${options.storeId}`

    const { isConnected, incomingMessages, send } = yield* connect(wsUrl)

    /**
     * We need to account for the scenario where push-caused PullRes message arrive before the pull-caused PullRes message.
     * i.e. a scenario where the WS connection is created but before the server processed the initial pull, a push from
     * another client triggers a PullRes message sent to this client which we need to stash until our pull-caused
     * PullRes message arrives at which point we can combine the stashed events with the pull-caused events and continue.
     */
    const stashedPullBatch: WSMessage.PullRes['batch'][number][] = []

    // We currently only support one pull stream for a sync backend.
    let pullStarted = false

    const api = {
      isConnected,
      pull: (args) =>
        Effect.gen(function* () {
          if (pullStarted) {
            return shouldNeverHappen(`Pull already started for this sync backend.`)
          }

          pullStarted = true

          let pullResponseReceived = false

          const requestId = nanoid()
          const cursor = Option.getOrUndefined(args)?.cursor.global

          yield* send(WSMessage.PullReq.make({ cursor, requestId }))

          return Stream.fromPubSub(incomingMessages).pipe(
            Stream.tap((_) =>
              _._tag === 'WSMessage.Error' && _.requestId === requestId
                ? new InvalidPullError({ message: _.message })
                : Effect.void,
            ),
            Stream.filterMap((msg) => {
              if (msg._tag === 'WSMessage.PullRes') {
                if (msg.requestId.context === 'pull') {
                  if (msg.requestId.requestId === requestId) {
                    pullResponseReceived = true

                    if (stashedPullBatch.length > 0 && msg.remaining === 0) {
                      const pullResHead = msg.batch.at(-1)?.mutationEventEncoded.id ?? EventId.ROOT.global
                      // Index where stashed events are greater than pullResHead
                      const newPartialBatchIndex = stashedPullBatch.findIndex(
                        (batchItem) => batchItem.mutationEventEncoded.id > pullResHead,
                      )
                      const batchWithNewStashedEvents =
                        newPartialBatchIndex === -1 ? [] : stashedPullBatch.slice(newPartialBatchIndex)
                      const combinedBatch = [...msg.batch, ...batchWithNewStashedEvents]
                      return Option.some({ ...msg, batch: combinedBatch, remaining: 0 })
                    } else {
                      return Option.some(msg)
                    }
                  } else {
                    // Ignore
                    return Option.none()
                  }
                } else {
                  if (pullResponseReceived) {
                    return Option.some(msg)
                  } else {
                    stashedPullBatch.push(...msg.batch)
                    return Option.none()
                  }
                }
              }

              return Option.none()
            }),
            // This call is mostly here to for type narrowing
            Stream.filter(Schema.is(WSMessage.PullRes)),
          )
        }).pipe(Stream.unwrap),

      push: (batch) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void, InvalidPushError>()
          const requestId = nanoid()

          yield* Stream.fromPubSub(incomingMessages).pipe(
            Stream.tap((_) =>
              _._tag === 'WSMessage.Error' && _.requestId === requestId
                ? Deferred.fail(ready, new InvalidPushError({ reason: { _tag: 'Unexpected', message: _.message } }))
                : Effect.void,
            ),
            Stream.filter((_) => _._tag === 'WSMessage.PushAck' && _.requestId === requestId),
            Stream.take(1),
            Stream.tap(() => Deferred.succeed(ready, void 0)),
            Stream.runDrain,
            Effect.tapCauseLogPretty,
            Effect.fork,
          )

          yield* send(WSMessage.PushReq.make({ batch, requestId }))

          yield* ready

          const createdAt = new Date().toISOString()

          return { metadata: Array.from({ length: batch.length }, () => Option.some({ createdAt })) }
        }),
    } satisfies SyncBackend<SyncMetadata>

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

        // TODO use MsgPack instead of JSON to speed up the serialization / reduce the size of the messages
        socketRef.current!.send(Schema.encodeSync(Schema.parseJson(WSMessage.Message))(message))

        if (LS_DEV) {
          yield* Effect.spanEvent(
            `Sent message: ${message._tag}`,
            message._tag === 'WSMessage.PushReq'
              ? {
                  id: message.batch[0]!.id,
                  parentId: message.batch[0]!.parentId,
                  batchLength: message.batch.length,
                }
              : message._tag === 'WSMessage.PullReq'
                ? { cursor: message.cursor ?? '-' }
                : {},
          )
        }
      })

    const innerConnect = Effect.gen(function* () {
      // If the browser already tells us we're offline, then we'll at least wait until the browser
      // thinks we're online again. (We'll only know for sure once the WS conneciton is established.)
      while (typeof navigator !== 'undefined' && navigator.onLine === false) {
        yield* Effect.sleep(1000)
      }
      // TODO bring this back in a cross-platform way
      // if (navigator.onLine === false) {
      //   yield* Effect.async((cb) => self.addEventListener('online', () => cb(Effect.void)))
      // }

      const socket = yield* WebSocket.makeWebSocket({ url: wsUrl, reconnect: Schedule.exponential(100) })
      // socket.binaryType = 'arraybuffer'

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
              // yield* Effect.logDebug(`decodedEventRes: ${decodedEventRes.right._tag}`)
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
      if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
        // TODO support an Expo equivalent for this
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
      }).pipe(Effect.withSpan('@livestore/sync-cf:connect:checkPingPong'), Effect.ignore)

      yield* waitUntilOnline.pipe(
        Effect.andThen(checkPingPong.pipe(Effect.forever)),
        Effect.tapErrorCause(() => Deferred.succeed(connectionClosed, void 0)),
        Effect.forkScoped,
      )

      yield* connectionClosed
    }).pipe(Effect.scoped, Effect.withSpan('@livestore/sync-cf:connect'))

    yield* innerConnect.pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)

    return { isConnected, incomingMessages, send }
  })
