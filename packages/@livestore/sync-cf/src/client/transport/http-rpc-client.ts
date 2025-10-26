import { InvalidPullError, InvalidPushError, SyncBackend, UnexpectedError } from '@livestore/common'
import type { EventSequenceNumber } from '@livestore/common/schema'
import { splitChunkBySize } from '@livestore/common/sync'
import { omit } from '@livestore/utils'
import {
  Chunk,
  type Duration,
  Effect,
  HttpClient,
  HttpClientRequest,
  identity,
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
import { MAX_HTTP_REQUEST_BYTES, MAX_PUSH_EVENTS_PER_REQUEST } from '../../common/constants.ts'
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
  livePull?: {
    /**
     * How often to poll for new events
     * @default 5 seconds
     */
    pollInterval?: Duration.DurationInput
  }
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

      const livePullInterval = options.livePull?.pollInterval ?? 5_000

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
        yield* rpcClient.SyncHttpRpc.Ping({ storeId, payload })

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

      const backendIdHelper = yield* SyncBackend.makeBackendIdHelper

      const mapCursor = (cursor: Option.Option<{ eventSequenceNumber: number }>) =>
        cursor.pipe(
          Option.map((a) => ({
            eventSequenceNumber: a.eventSequenceNumber as EventSequenceNumber.GlobalEventSequenceNumber,
            backendId: backendIdHelper.get().pipe(Option.getOrThrow),
          })),
        )

      const pull: SyncBackend.SyncBackend<SyncMetadata>['pull'] = (cursor, options) =>
        rpcClient.SyncHttpRpc.Pull({
          storeId,
          payload,
          cursor: mapCursor(cursor),
        }).pipe(
          options?.live
            ? // Phase 2: Simulate `live` pull by polling for new events
              Stream.concatWithLastElement((lastElement) => {
                const initialPhase2Cursor = lastElement.pipe(
                  Option.flatMap((_) => Option.fromNullable(_.batch.at(-1)?.eventEncoded.seqNum)),
                  Option.map((eventSequenceNumber) => ({ eventSequenceNumber })),
                  Option.orElse(() => cursor),
                  mapCursor,
                )

                return Stream.unfoldChunkEffect(initialPhase2Cursor, (currentCursor) =>
                  Effect.gen(function* () {
                    yield* Effect.sleep(livePullInterval)

                    const items = yield* rpcClient.SyncHttpRpc.Pull({ storeId, payload, cursor: currentCursor }).pipe(
                      Stream.runCollect,
                    )

                    const nextCursor = Chunk.last(items).pipe(
                      Option.flatMap((item) => Option.fromNullable(item.batch.at(-1)?.eventEncoded.seqNum)),
                      Option.map((eventSequenceNumber) => ({ eventSequenceNumber })),
                      Option.orElse(() => currentCursor),
                      mapCursor,
                    )

                    return Option.some([items, nextCursor])
                  }),
                )
              })
            : identity,
          Stream.tap((res) => backendIdHelper.lazySet(res.backendId)),
          Stream.map((res) => omit(res, ['backendId'])),
          Stream.mapError((cause) => (cause._tag === 'InvalidPullError' ? cause : InvalidPullError.make({ cause }))),
          Stream.withSpan('http-sync-client:pull'),
        )

      const pushSemaphore = yield* Effect.makeSemaphore(1)

      const push: SyncBackend.SyncBackend<SyncMetadata>['push'] = (batch) =>
        Effect.gen(function* () {
          if (batch.length === 0) {
            return
          }

          const backendId = backendIdHelper.get()
          const batchChunks = yield* Chunk.fromIterable(batch).pipe(
            splitChunkBySize({
              maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
              maxBytes: MAX_HTTP_REQUEST_BYTES,
              encode: (items) => ({
                batch: items,
                storeId,
                payload,
                backendId,
              }),
            }),
            Effect.mapError((cause) => new InvalidPushError({ cause: new UnexpectedError({ cause }) })),
          )

          for (const chunk of Chunk.toReadonlyArray(batchChunks)) {
            const chunkArray = Chunk.toReadonlyArray(chunk)
            yield* rpcClient.SyncHttpRpc.Push({ storeId, payload, batch: chunkArray, backendId })
          }
        }).pipe(
          pushSemaphore.withPermits(1),
          Effect.mapError((cause) =>
            cause._tag === 'InvalidPushError' ? cause : new InvalidPushError({ cause: new UnexpectedError({ cause }) }),
          ),
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
          pullPageInfoKnown: true,
          pullLive: true,
        },
      })
    })
