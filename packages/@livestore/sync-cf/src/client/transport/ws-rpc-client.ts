import { InvalidPullError, InvalidPushError, IsOfflineError, SyncBackend, UnexpectedError } from '@livestore/common'
import {
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
  type WebSocket,
} from '@livestore/utils/effect'

import { SearchParamsSchema } from '../../common/mod.ts'
import type { SyncMetadata } from '../../common/sync-message-types.ts'
import { SyncWsRpc } from '../../common/ws-rpc-schema.ts'

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

      return SyncBackend.of<SyncMetadata>({
        isConnected,
        connect: ping,
        pull: (args, options) =>
          rpcClient.SyncWsRpc.Pull({
            storeId,
            payload,
            cursor: Option.getOrUndefined(args)?.cursor,
            live: options?.live ?? false,
          }).pipe(
            Stream.mapError((cause) =>
              cause._tag === 'RpcClientError' && Socket.isSocketError(cause.cause)
                ? new IsOfflineError({ cause: cause.cause })
                : new InvalidPullError({ cause }),
            ),
            Stream.withSpan('pull'),
          ),

        push: (batch) =>
          Effect.gen(function* () {
            if (batch.length === 0) {
              return
            }

            return yield* rpcClient.SyncWsRpc.Push({ storeId, payload, batch }).pipe(
              Effect.mapError(
                (cause) =>
                  new InvalidPushError({
                    reason:
                      cause._tag === 'SyncMessage.SyncError' &&
                      cause.cause._tag === 'SyncMessage.SyncError.InvalidParentEventNumber'
                        ? {
                            _tag: 'ServerAhead',
                            minimumExpectedNum: cause.cause.expected,
                            providedNum: cause.cause.received,
                          }
                        : { _tag: 'Unexpected', cause },
                  }),
              ),
            )
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
