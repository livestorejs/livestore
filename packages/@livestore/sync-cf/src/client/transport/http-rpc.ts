import { InvalidPullError, InvalidPushError, SyncBackend, UnexpectedError } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import {
  type Duration,
  Effect,
  HttpClient,
  HttpClientRequest,
  Layer,
  Option,
  RpcClient,
  RpcSerialization,
  Schedule,
  Schema,
  Stream,
  SubscriptionRef,
  UrlParams,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { SyncHttpRpc } from '../../common/http-rpc-schema.ts'
import { SearchParamsSchema } from '../../common/mod.ts'
import type { SyncMetadata } from '../../common/sync-message-types.ts'

export interface HttpSyncOptions {
  /**
   * URL of the sync backend
   *
   * @example
   * ```ts
   * const syncBackend = makeHttpSync({ url: 'https://sync.example.com' })
   * ```
   */
  url: string
  headers?: Record<string, string>
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
 * Note: This implementation requires the `enable_request_signal` compatibility flag to properly support `pull` streaming responses
 */
export const makeHttpSync =
  (options: HttpSyncOptions): SyncBackend.SyncBackendConstructor<SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      // Based on ping responses
      const isConnected = yield* SubscriptionRef.make(false)

      const urlParamsData = yield* Schema.encode(SearchParamsSchema)({
        storeId,
        payload,
        transport: 'http',
      }).pipe(UnexpectedError.mapToUnexpectedError)

      const urlParams = UrlParams.fromInput(urlParamsData)

      // Setup HTTP RPC Protocol
      const HttpProtocolLive = RpcClient.layerProtocolHttp({
        url: `${options.url}?${UrlParams.toString(urlParams)}`,
        transformClient: HttpClient.mapRequest((request) =>
          request.pipe(
            HttpClientRequest.setHeaders({
              ...options.headers,
              // Used in CF Worker to identify the store (additionally to storeId embedded in the RPC requests)
              'x-livestore-store-id': storeId,
            }),
          ),
        ),
      }).pipe(Layer.provide(RpcSerialization.layerJson))

      const rpcClient = yield* RpcClient.make(SyncHttpRpc).pipe(Effect.provide(HttpProtocolLive))

      const pingTimeout = options.ping?.requestTimeout ?? 10_000

      const ping: SyncBackend.SyncBackend<SyncMetadata>['ping'] = Effect.gen(function* () {
        const requestId = nanoid()
        const res = yield* rpcClient.SyncHttpRpc.Ping({ storeId, payload, requestId })
        if (res.requestId !== requestId) {
          return shouldNeverHappen(
            `Ping response requestId ${res.requestId} does not match expected requestId ${requestId}`,
          )
        }

        yield* SubscriptionRef.set(isConnected, true)
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.timeout(pingTimeout),
        Effect.catchTag('TimeoutException', () => SubscriptionRef.set(isConnected, false)),
      )

      const pingInterval = options.ping?.requestInterval ?? 10_000

      if (options.ping?.enabled !== false) {
        // Automatically ping the server to keep the connection alive
        yield* ping.pipe(Effect.repeat(Schedule.spaced(pingInterval)), Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      // Helps already establish a TCP connection to the server
      const connect = ping.pipe(UnexpectedError.mapToUnexpectedError)

      const pull: SyncBackend.SyncBackend<SyncMetadata>['pull'] = (args) => {
        const cursor = Option.getOrUndefined(args)?.cursor
        const requestId = nanoid()

        return rpcClient.SyncHttpRpc.Pull({
          storeId,
          payload,
          requestId,
          cursor,
          live: false, // TODO
        }).pipe(
          // Effect.map(Stream.fromIterable),
          // Stream.unwrap,
          // Stream.map((pullRes) => ({
          //   batch: pullRes.batch,
          //   remaining: pullRes.remaining,
          // })),
          Stream.mapError((cause) => new InvalidPullError({ cause })),
          Stream.withSpan('http-sync-client:pull'),
        )
      }

      const pushSemaphore = yield* Effect.makeSemaphore(1)

      const push: SyncBackend.SyncBackend<SyncMetadata>['push'] = (batch) =>
        Effect.gen(function* () {
          if (batch.length === 0) {
            return
          }

          const requestId = nanoid()

          yield* rpcClient.SyncHttpRpc.Push({
            storeId,
            payload,
            requestId,
            batch,
          })
        }).pipe(
          pushSemaphore.withPermits(1),
          Effect.mapError((error) => new InvalidPushError({ reason: { _tag: 'Unexpected', cause: error } })),
          Effect.withSpan('http-sync-client:push'),
        )

      return SyncBackend.of({
        connect,
        isConnected,
        pull,
        push,
        ping,
        metadata: {
          name: '@livestore/cf-sync-http',
          description: 'LiveStore sync backend implementation using HTTP RPC',
          protocol: 'http',
          url: options.url,
        },
        supports: {
          pullRemainingCount: true,
          pullLive: true,
        },
      })
    })
