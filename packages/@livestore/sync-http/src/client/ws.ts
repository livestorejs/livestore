import { InvalidPullError, InvalidPushError, IsOfflineError, SyncBackend, UnknownError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import { splitChunkBySize } from '@livestore/common/sync'
import { omit } from '@livestore/utils'
import {
  Chunk,
  type Duration,
  Effect,
  Layer,
  Option,
  RpcClient,
  RpcSerialization,
  Schedule,
  Schema,
  type Scope,
  Socket,
  Stream,
  SubscriptionRef,
  UrlParams,
} from '@livestore/utils/effect'
import type { WebSocket } from '@livestore/utils/effect/browser'
import { MAX_PUSH_EVENTS_PER_REQUEST, MAX_TRANSPORT_PAYLOAD_BYTES, type SyncMessage, SyncWsRpc } from '../common/mod.ts'

export interface WsSyncOptions {
  /**
   * URL of the sync server
   *
   * The protocol should be `ws` or `wss` (or `http`/`https` which will be converted)
   *
   * @example 'ws://localhost:3000'
   */
  url: string
  /**
   * Optional WebSocket factory for custom WebSocket implementations
   */
  webSocketFactory?: (wsUrl: string) => Effect.Effect<globalThis.WebSocket, WebSocket.WebSocketError, Scope.Scope>
  /**
   * Ping configuration for connection health checks
   */
  ping?: {
    /**
     * Whether to enable automatic pinging
     * @default true
     */
    enabled?: boolean
    /**
     * How long to wait for a ping response before timing out
     * @default 10000ms
     */
    requestTimeout?: Duration.DurationInput
    /**
     * How often to send ping requests
     * @default 10000ms
     */
    requestInterval?: Duration.DurationInput
  }
}

const SearchParamsSchema = Schema.Struct({
  storeId: Schema.String,
  payload: Schema.compose(Schema.StringFromUriComponent, Schema.parseJson(Schema.JsonValue)).pipe(Schema.UndefinedOr),
})

/**
 * Converts HTTP URL to WebSocket URL
 */
const toWsUrl = (url: string): string => {
  if (url.startsWith('http://')) return url.replace('http://', 'ws://')
  if (url.startsWith('https://')) return url.replace('https://', 'wss://')
  return url
}

/**
 * Creates a WebSocket sync backend that communicates with a sync-http server.
 * Uses persistent WebSocket connection for real-time updates.
 */
export const makeWsSync =
  (options: WsSyncOptions): SyncBackend.SyncBackendConstructor<SyncMessage.SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const urlParamsData = yield* Schema.encode(SearchParamsSchema)({
        storeId,
        payload,
      }).pipe(UnknownError.mapToUnknownError)

      const urlParams = UrlParams.fromInput(urlParamsData)
      const wsUrl = `${toWsUrl(options.url)}/ws?${UrlParams.toString(urlParams)}`

      const isConnected = yield* SubscriptionRef.make(false)

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

      // Build the layer eagerly to tie it to the scope
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
        UnknownError.mapToUnknownError,
        Effect.withSpan('sync-http-ws:ping'),
      )

      const backendIdHelper = yield* SyncBackend.makeBackendIdHelper

      return SyncBackend.of<SyncMessage.SyncMetadata>({
        isConnected,
        connect: ping,
        pull: (cursor, pullOptions) =>
          rpcClient.SyncWsRpc.Pull({
            storeId,
            payload,
            cursor: cursor.pipe(
              Option.map((a) => ({
                eventSequenceNumber: a.eventSequenceNumber,
                backendId: backendIdHelper.get().pipe(Option.getOrThrow),
              })),
            ),
            live: pullOptions?.live ?? false,
          }).pipe(
            Stream.tap((res) => backendIdHelper.lazySet(res.backendId)),
            Stream.map((res) => omit(res, ['backendId'])),
            Stream.mapError((cause) =>
              cause._tag === 'RpcClientError' && Socket.isSocketError(cause.cause)
                ? new IsOfflineError({ cause: cause.cause })
                : cause._tag === 'InvalidPullError'
                  ? cause
                  : InvalidPullError.make({ cause }),
            ),
            Stream.withSpan('sync-http-ws:pull'),
          ),

        push: (batch) =>
          Effect.gen(function* () {
            if (batch.length === 0) return

            const encodePayload = (items: ReadonlyArray<LiveStoreEvent.Global.Encoded>) => ({
              storeId,
              payload,
              batch: items,
              backendId: backendIdHelper.get(),
            })

            const chunksChunk = yield* Chunk.fromIterable(batch).pipe(
              splitChunkBySize({
                maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
                maxBytes: MAX_TRANSPORT_PAYLOAD_BYTES,
                encode: encodePayload,
              }),
              Effect.mapError((cause) => new InvalidPushError({ cause: new UnknownError({ cause }) })),
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
                    : new InvalidPushError({ cause: new UnknownError({ cause }) }),
                ),
              )
            }
          }).pipe(Effect.withSpan('sync-http-ws:push')),
        ping,
        metadata: {
          name: '@livestore/sync-http',
          description: 'LiveStore sync backend using WebSocket transport',
          protocol: 'ws',
          url: options.url,
        },
        supports: {
          pullPageInfoKnown: true,
          pullLive: true,
        },
      })
    })
