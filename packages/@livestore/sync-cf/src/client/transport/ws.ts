/// <reference lib="dom" />

import { InvalidPullError, InvalidPushError, SyncBackend, UnexpectedError } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { LS_DEV, shouldNeverHappen } from '@livestore/utils'
import {
  Deferred,
  Effect,
  Option,
  PubSub,
  Queue,
  Schedule,
  Schema,
  type Scope,
  Stream,
  SubscriptionRef,
  UrlParams,
  WebSocket,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { SearchParamsSchema, SyncMessage } from '../../common/mod.ts'
import type { SyncMetadata } from '../../common/sync-message-types.ts'

export interface WsSyncOptions {
  url: string
  /**
   * Optional WebSocket factory for custom WebSocket implementations (e.g., Cloudflare Durable Objects)
   * If not provided, uses standard WebSocket from @livestore/utils/effect
   */
  webSocketFactory?: (wsUrl: string) => Effect.Effect<globalThis.WebSocket, WebSocket.WebSocketError, Scope.Scope>
}

export const makeCfSync =
  (options: WsSyncOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const urlParamsData = yield* Schema.encode(SearchParamsSchema)({
        storeId,
        payload,
      }).pipe(UnexpectedError.mapToUnexpectedError)

      const urlParams = UrlParams.fromInput(urlParamsData)
      const wsUrl = `${options.url}/sync?${UrlParams.toString(urlParams)}`

      const { isConnected, incomingMessages, send } = yield* connect(wsUrl, options.webSocketFactory)

      /**
       * We need to account for the scenario where push-caused PullRes message arrive before the pull-caused PullRes message.
       * i.e. a scenario where the WS connection is created but before the server processed the initial pull, a push from
       * another client triggers a PullRes message sent to this client which we need to stash until our pull-caused
       * PullRes message arrives at which point we can combine the stashed events with the pull-caused events and continue.
       */
      const stashedPullBatch: SyncMessage.PullResponse['batch'][number][] = []

      // We currently only support one pull stream for a sync backend.
      let pullStarted = false

      return SyncBackend.of<SyncMetadata>({
        isConnected,
        // Currently we're already eagerly connecting when the sync backend is created but we might want to refactor this later to clean this up
        connect: isConnected.pipe(SubscriptionRef.waitUntil(Boolean), Effect.asVoid),
        pull: (args) =>
          Effect.gen(function* () {
            if (pullStarted) {
              return shouldNeverHappen(`Pull already started for this sync backend.`)
            }

            pullStarted = true

            let pullResponseReceived = false

            const requestId = nanoid()
            const cursor = Option.getOrUndefined(args)?.cursor

            yield* send(SyncMessage.PullRequest.make({ cursor, requestId }))

            return Stream.fromPubSub(incomingMessages).pipe(
              Stream.tap((_) =>
                _._tag === 'SyncMessage.SyncError' && _.requestId === requestId
                  ? new InvalidPullError({ cause: _ })
                  : Effect.void,
              ),
              Stream.filterMap((msg) => {
                if (msg._tag === 'SyncMessage.PullResponse') {
                  if (msg.requestId.context === 'pull') {
                    if (msg.requestId.requestId === requestId) {
                      pullResponseReceived = true

                      if (stashedPullBatch.length > 0 && msg.remaining === 0) {
                        const pullResHead = msg.batch.at(-1)?.eventEncoded.seqNum ?? EventSequenceNumber.ROOT.global
                        // Index where stashed events are greater than pullResHead
                        const newPartialBatchIndex = stashedPullBatch.findIndex(
                          (batchItem) => batchItem.eventEncoded.seqNum > pullResHead,
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
            )
          }).pipe(Stream.unwrap),

        push: (batch) =>
          Effect.gen(function* () {
            if (batch.length === 0) {
              return
            }

            const pushAck = yield* Deferred.make<void, InvalidPushError>()
            const requestId = nanoid()

            yield* Stream.fromPubSub(incomingMessages).pipe(
              Stream.tap((_) =>
                _._tag === 'SyncMessage.SyncError' && _.requestId === requestId
                  ? Deferred.fail(pushAck, new InvalidPushError({ reason: { _tag: 'Unexpected', cause: _ } }))
                  : Effect.void,
              ),
              Stream.filter((_) => _._tag === 'SyncMessage.PushAck' && _.requestId === requestId),
              Stream.take(1),
              Stream.tap(() => Deferred.succeed(pushAck, void 0)),
              Stream.runDrain,
              Effect.tapCauseLogPretty,
              Effect.fork,
            )

            yield* send(SyncMessage.PushRequest.make({ batch, requestId }))

            yield* pushAck
          }),
        ping: Effect.gen(function* () {
          // yield* send(SyncMessage.Ping.make({ requestId: 'ping' }))
          // yield* send({ _tag: 'SyncMessage.Ping', requestId: 'ping' })
          // TODO wait for pong
        }),
        metadata: {
          name: '@livestore/cf-sync',
          description: 'LiveStore sync backend implementation using Cloudflare Workers & Durable Objects',
          protocol: 'ws',
          url: options.url,
        },
      })
    })

const connect = (
  wsUrl: string,
  webSocketFactory?: (wsUrl: string) => Effect.Effect<globalThis.WebSocket, WebSocket.WebSocketError, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const isConnected = yield* SubscriptionRef.make(false)
    const socketRef: { current: globalThis.WebSocket | undefined } = { current: undefined }

    const incomingMessages = yield* PubSub.unbounded<
      Exclude<SyncMessage.BackendToClientMessage, SyncMessage.Pong>
    >().pipe(Effect.acquireRelease(PubSub.shutdown))

    const waitUntilOnline = isConnected.changes.pipe(Stream.filter(Boolean), Stream.take(1), Stream.runDrain)

    const send = (message: SyncMessage.Message) =>
      Effect.gen(function* () {
        // Wait first until we're online
        yield* waitUntilOnline

        // TODO use MsgPack instead of JSON to speed up the serialization / reduce the size of the messages
        socketRef.current!.send(Schema.encodeSync(Schema.parseJson(SyncMessage.Message))(message))

        if (LS_DEV) {
          yield* Effect.spanEvent(
            `Sent message: ${message._tag}`,
            message._tag === 'SyncMessage.PushRequest'
              ? {
                  seqNum: message.batch[0]!.seqNum,
                  parentSeqNum: message.batch[0]!.parentSeqNum,
                  batchLength: message.batch.length,
                }
              : message._tag === 'SyncMessage.PullRequest'
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

      const socket = yield* webSocketFactory
        ? webSocketFactory(wsUrl)
        : WebSocket.makeWebSocket({ url: wsUrl, reconnect: Schedule.exponential(100) })
      // socket.binaryType = 'arraybuffer'

      yield* SubscriptionRef.set(isConnected, true)
      socketRef.current = socket

      const connectionClosed = yield* Deferred.make<void>()

      const pongMessages = yield* Queue.unbounded<SyncMessage.Pong>().pipe(Effect.acquireRelease(Queue.shutdown))

      yield* Effect.eventListener(socket, 'message', (event: MessageEvent) =>
        Effect.gen(function* () {
          const decodedEventRes = Schema.decodeUnknownEither(Schema.parseJson(SyncMessage.BackendToClientMessage))(
            event.data,
          )

          if (decodedEventRes._tag === 'Left') {
            console.error('Sync: Invalid message received', decodedEventRes.left)
            return
          } else {
            if (decodedEventRes.right._tag === 'SyncMessage.Pong') {
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

      if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
        // TODO support an Expo equivalent for this

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
        yield* send({ _tag: 'SyncMessage.Ping', requestId: 'ping' })

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
