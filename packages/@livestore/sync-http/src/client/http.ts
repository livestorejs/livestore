import { InvalidPullError, InvalidPushError, SyncBackend, UnknownError } from '@livestore/common'
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
import {
  MAX_PUSH_EVENTS_PER_REQUEST,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  SyncHttpRpc,
  type SyncMessage,
} from '../common/mod.ts'

export interface HttpSyncOptions {
  /**
   * URL of the sync server
   *
   * @example
   * ```ts
   * const syncBackend = makeHttpSync({ url: 'http://localhost:3000' })
   * ```
   */
  url: string
  /**
   * Custom headers to send with each request
   */
  headers?: Record<string, string>
  /**
   * Live pull configuration
   */
  livePull?: {
    /**
     * How often to poll for new events (when using polling mode)
     * @default 5000ms
     */
    pollInterval?: Duration.DurationInput
  }
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
 * Creates an HTTP sync backend that communicates with a sync-http server.
 * Uses HTTP RPC for pull/push operations and polling for live updates.
 */
export const makeHttpSync =
  (options: HttpSyncOptions): SyncBackend.SyncBackendConstructor<SyncMessage.SyncMetadata> =>
  ({ storeId, payload }) =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(false)

      const livePullInterval = options.livePull?.pollInterval ?? 5_000

      const urlParamsData = yield* Schema.encode(SearchParamsSchema)({
        storeId,
        payload,
      }).pipe(UnknownError.mapToUnknownError)

      const urlParams = UrlParams.fromInput(urlParamsData)

      // Setup HTTP RPC Protocol
      const HttpProtocolLive = RpcClient.layerProtocolHttp({
        url: `${options.url}/rpc?${UrlParams.toString(urlParams)}`,
        transformClient: HttpClient.mapRequest((request) =>
          request.pipe(
            HttpClientRequest.setHeaders({
              ...options.headers,
              'x-livestore-store-id': storeId,
            }),
          ),
        ),
      }).pipe(Layer.provide(RpcSerialization.layerJson))

      const rpcClient = yield* RpcClient.make(SyncHttpRpc).pipe(Effect.provide(HttpProtocolLive))

      const pingTimeout = options.ping?.requestTimeout ?? 10_000

      const ping: SyncBackend.SyncBackend<SyncMessage.SyncMetadata>['ping'] = Effect.gen(function* () {
        yield* rpcClient.SyncHttpRpc.Ping({ storeId, payload })
        yield* SubscriptionRef.set(isConnected, true)
      }).pipe(
        UnknownError.mapToUnknownError,
        Effect.timeout(pingTimeout),
        Effect.catchTag('TimeoutException', () => SubscriptionRef.set(isConnected, false)),
      )

      const pingInterval = options.ping?.requestInterval ?? 10_000

      if (options.ping?.enabled !== false) {
        yield* ping.pipe(Effect.repeat(Schedule.spaced(pingInterval)), Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      const connect = ping.pipe(UnknownError.mapToUnknownError)

      const backendIdHelper = yield* SyncBackend.makeBackendIdHelper

      const mapCursor = (cursor: Option.Option<{ eventSequenceNumber: number }>) =>
        cursor.pipe(
          Option.map((a) => ({
            eventSequenceNumber: a.eventSequenceNumber as EventSequenceNumber.Global.Type,
            backendId: backendIdHelper.get().pipe(Option.getOrThrow),
          })),
        )

      const pull: SyncBackend.SyncBackend<SyncMessage.SyncMetadata>['pull'] = (cursor, pullOptions) =>
        rpcClient.SyncHttpRpc.Pull({
          storeId,
          payload,
          cursor: mapCursor(cursor),
        }).pipe(
          pullOptions?.live
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
          Stream.withSpan('sync-http-client:pull'),
        )

      const pushSemaphore = yield* Effect.makeSemaphore(1)

      const push: SyncBackend.SyncBackend<SyncMessage.SyncMetadata>['push'] = (batch) =>
        Effect.gen(function* () {
          if (batch.length === 0) {
            return
          }

          const backendId = backendIdHelper.get()
          const batchChunks = yield* Chunk.fromIterable(batch).pipe(
            splitChunkBySize({
              maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
              maxBytes: MAX_TRANSPORT_PAYLOAD_BYTES,
              encode: (items) => ({
                batch: items,
                storeId,
                payload,
                backendId,
              }),
            }),
            Effect.mapError((cause) => new InvalidPushError({ cause: new UnknownError({ cause }) })),
          )

          for (const chunk of Chunk.toReadonlyArray(batchChunks)) {
            const chunkArray = Chunk.toReadonlyArray(chunk)
            yield* rpcClient.SyncHttpRpc.Push({ storeId, payload, batch: chunkArray, backendId })
          }
        }).pipe(
          pushSemaphore.withPermits(1),
          Effect.mapError((cause) =>
            cause._tag === 'InvalidPushError' ? cause : new InvalidPushError({ cause: new UnknownError({ cause }) }),
          ),
          Effect.withSpan('sync-http-client:push'),
        )

      return SyncBackend.of({
        connect,
        isConnected,
        pull,
        push,
        ping,
        metadata: {
          name: '@livestore/sync-http',
          description: 'LiveStore sync backend using HTTP transport',
          protocol: 'http',
          url: options.url,
        },
        supports: {
          pullPageInfoKnown: true,
          pullLive: true,
        },
      })
    })
