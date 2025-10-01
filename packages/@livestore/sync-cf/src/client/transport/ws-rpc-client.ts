import {
  InvalidPullError,
  InvalidPushError,
  IsOfflineError,
  SyncBackend,
  UnexpectedError,
} from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import { splitChunkBySize } from '@livestore/common/sync'
import { omit } from '@livestore/utils'
import {
  Chunk,
  type Duration,
  Effect,
  Layer,
  Option,
  Ref,
  RpcClient,
  RpcSerialization,
  Schedule,
  Schema,
  type Scope,
  Socket,
  Stream,
  SubscriptionRef,
  UrlParams,
  type WebSocket,
} from '@livestore/utils/effect'
import { MAX_PUSH_EVENTS_PER_REQUEST, MAX_WS_MESSAGE_BYTES } from '../../common/constants.ts'
import { SearchParamsSchema } from '../../common/mod.ts'
import type { SyncMetadata } from '../../common/sync-message-types.ts'
import { SyncWsRpc } from '../../common/ws-rpc-schema.ts'

/**
 * Temporary fail-fast until we add resume semantics for mid-stream socket closes.
 */
export class PullStreamInterruptedError extends Schema.TaggedError<PullStreamInterruptedError>()(
  'PullStreamInterruptedError',
  {
    storeId: Schema.String,
    remaining: Schema.Number,
    chunkIndex: Schema.Number,
  },
) {}

export interface WsSyncOptions {
  /**
   * URL of the sync backend
   *
   * The protocol can either `http`/`https` or `ws`/`wss`
   *
   * @example 'https://sync.example.com'
   */
  url: string
  /**
   * Optional WebSocket factory for custom WebSocket implementations (e.g., Cloudflare Durable Objects)
   * If not provided, uses standard WebSocket from @livestore/utils/effect
   */
  webSocketFactory?: (wsUrl: string) => Effect.Effect<globalThis.WebSocket, WebSocket.WebSocketError, Scope.Scope>
  ping?: {
    /**
     * @default true
     */
    enabled?: boolean
    /**
     * How long to wait for a ping response before timing out
     * @default 10 seconds
     */
    requestTimeout?: Duration.DurationInput
    /**
     * How often to send ping requests
     * @default 10 seconds
     */
    requestInterval?: Duration.DurationInput
  }
}

/**
 * Creates a sync backend that uses WebSocket to communicate with the sync backend.
 *
 * @example
 * ```ts
 * import { makeWsSync } from '@livestore/sync-cf/client'
 *
 * const syncBackend = makeWsSync({ url: 'wss://sync.example.com' })
 */
export const makeWsSync =
  (options: WsSyncOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const urlParamsData = yield* Schema.encode(SearchParamsSchema)({
        storeId,
        payload,
        transport: 'ws',
      }).pipe(UnexpectedError.mapToUnexpectedError)

      const urlParams = UrlParams.fromInput(urlParamsData)
      const wsUrl = `${options.url}?${UrlParams.toString(urlParams)}`

      const isConnected = yield* SubscriptionRef.make(false)

      // TODO bring this back in a cross-platform way
      // If the browser already tells us we're offline, then we'll at least wait until the browser
      // thinks we're online again. (We'll only know for sure once the WS conneciton is established.)
      // while (typeof navigator !== 'undefined' && navigator.onLine === false) {
      //   yield* Effect.sleep(1000)
      // }
      // TODO bring this back in a cross-platform way
      // if (navigator.onLine === false) {
      //   yield* Effect.async((cb) => self.addEventListener('online', () => cb(Effect.void)))
      // }

      const pingInterval = options.ping?.requestInterval ?? 10_000

      const ProtocolLive = RpcClient.layerProtocolSocketWithIsConnected({
        isConnected,
        retryTransientErrors: Schedule.fixed(1000),
        pingSchedule: Schedule.once.pipe(Schedule.andThen(Schedule.fixed(pingInterval))),
        url: wsUrl,
      }).pipe(
        Layer.provide(Socket.layerWebSocket(wsUrl)),
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
        Layer.provide(RpcSerialization.layerJson),
      )

      // Warning: we need to build the layer here eagerly to tie it to the scope
      // instead of using `Effect.provide(ProtocolLive)` which would close the layer scope too early
      const ctx = yield* Layer.build(ProtocolLive)

      const rpcClient = yield* RpcClient.make(SyncWsRpc).pipe(Effect.provide(ctx))

      const pingTimeout = options.ping?.requestTimeout ?? 10_000

      const ping = Effect.gen(function* () {
        const pinger = yield* RpcClient.SocketPinger.pipe(Effect.provide(ctx))
        yield* pinger.ping
        yield* SubscriptionRef.set(isConnected, true)
      }).pipe(
        Effect.timeout(pingTimeout),
        Effect.catchTag('TimeoutException', () => SubscriptionRef.set(isConnected, false)),
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('ping'),
      )

      const backendIdHelper = yield* SyncBackend.makeBackendIdHelper

      type PullItem = SyncBackend.PullResItem<LiveStoreEvent.AnyEncodedGlobal>

      return SyncBackend.of<SyncMetadata>({
        isConnected,
        connect: ping,
        pull: (cursor, options) =>
          Stream.unwrapScoped(
            Effect.gen(function* () {
              const chunkIndexRef = yield* Ref.make(0)
              const pendingRemainingRef = yield* Ref.make(Option.none<{
                remaining: number
                chunkIndex: number
              }>())

              const base = rpcClient.SyncWsRpc.Pull({
                storeId,
                payload,
                cursor: cursor.pipe(
                  Option.map((a) => ({
                    eventSequenceNumber: a.eventSequenceNumber,
                    backendId: backendIdHelper.get().pipe(Option.getOrThrow),
                  })),
                ),
                live: options?.live ?? false,
              }).pipe(
                Stream.tap((res) =>
                  Effect.gen(function* () {
                    yield* backendIdHelper.lazySet(res.backendId)

                    yield* Ref.update(chunkIndexRef, (count) => count + 1)
                    const chunkIndex = yield* Ref.get(chunkIndexRef)

                    if (res.pageInfo._tag === 'MoreKnown') {
                      yield* Ref.set(
                        pendingRemainingRef,
                        Option.some({ remaining: res.pageInfo.remaining, chunkIndex }),
                      )
                    } else {
                      yield* Ref.set(pendingRemainingRef, Option.none())
                    }
                  }),
                ),
                Stream.map((res) => omit(res, ['backendId']) as PullItem),
              )

              const tail = Stream.unwrap(
                Ref.get(pendingRemainingRef).pipe(
                  Effect.map((pending) =>
                    Option.match(pending, {
                      // No pending remainder: stream completed normally.
                      onNone: () => Stream.empty as Stream.Stream<PullItem>,
                      onSome: ({ remaining, chunkIndex }) =>
                        // Fail fast so callers surface the interruption instead of hanging.
                        Stream.fail<PullItem, PullStreamInterruptedError>(
                          new PullStreamInterruptedError({ storeId, remaining, chunkIndex }),
                        ),
                    }),
                  ),
                ),
              )

              return base.pipe(
                Stream.concat<PullItem, never, never>(tail),
              )
            }),
          ).pipe(
            Stream.mapError((cause) =>
              cause._tag === 'RpcClientError' && Socket.isSocketError(cause.cause)
                ? new IsOfflineError({ cause: cause.cause })
                : cause._tag === 'InvalidPullError' || cause._tag === 'PullStreamInterruptedError'
                  ? cause
                  : InvalidPullError.make({ cause }),
            ),
            Stream.withSpan('pull'),
          ),

        push: (batch) =>
          Effect.gen(function* () {
            if (batch.length === 0) return

            const encodePayload = (batch: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) => ({
              storeId,
              payload,
              batch,
              backendId: backendIdHelper.get(),
            })

            const chunksChunk = yield* Chunk.fromIterable(batch).pipe(
              splitChunkBySize({
                maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
                maxBytes: MAX_WS_MESSAGE_BYTES,
                encode: encodePayload,
              }),
              Effect.mapError((cause) => new InvalidPushError({ cause: new UnexpectedError({ cause }) })),
            )

            for (const sub of chunksChunk) {
              yield* rpcClient.SyncWsRpc.Push({
                storeId,
                payload,
                batch: Chunk.toReadonlyArray(sub),
                backendId: backendIdHelper.get(),
              }).pipe(
                Effect.mapError((cause) =>
                  cause._tag === 'InvalidPushError'
                    ? cause
                    : new InvalidPushError({ cause: new UnexpectedError({ cause }) }),
                ),
              )
            }
          }).pipe(Effect.withSpan('push')),
        ping,
        metadata: {
          name: '@livestore/cf-sync',
          description: 'LiveStore sync backend implementation using Cloudflare Workers & Durable Objects',
          protocol: 'ws',
          url: options.url,
        },
        supports: {
          pullPageInfoKnown: true,
          pullLive: true,
        },
      })
    })
