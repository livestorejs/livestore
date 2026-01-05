import {
  BackendIdMismatchError,
  InvalidPullError,
  type InvalidPushError,
  IsOfflineError,
  SyncBackend,
  UnknownError,
} from '@livestore/common'
import { EventSequenceNumber, type LiveStoreEvent } from '@livestore/common/schema'
import {
  type Cause,
  Context,
  Effect,
  HttpClient,
  Option,
  ReadonlyArray,
  RpcClient,
  RpcSerialization,
  Schedule,
  type Scope,
  Socket,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'
import { SyncRpcGroup } from '../shared.ts'

export class ConnectionManager extends Context.Tag('@livestore/sync-http/client/ConnectionManager')<
  ConnectionManager,
  {
    readonly isConnected: SubscriptionRef.SubscriptionRef<boolean>

    readonly connect: Effect.Effect<void, UnknownError, Scope.Scope>

    readonly ping: Effect.Effect<void, UnknownError | Cause.TimeoutException>

    readonly pull: (options: {
      readonly cursor: Option.Option<EventSequenceNumber.Global.Type>
      readonly live: boolean
    }) => Stream.Stream<SyncBackend.PullResItem, InvalidPullError | IsOfflineError>

    readonly push: (events: ReadonlyArray<LiveStoreEvent.Global.Encoded>) => Effect.Effect<void, InvalidPushError>
  }
>() {
  static readonly make = Effect.fnUntraced(function* (options: {
    readonly baseUrl: string
    readonly storeId: string
    readonly clientId: string
    readonly protocol: 'websocket' | 'http'
  }) {
    const isConnected = yield* SubscriptionRef.make(false)
    const httpClient = yield* HttpClient.HttpClient
    const backendIdHelper = yield* SyncBackend.makeBackendIdHelper

    const protocol =
      options.protocol === 'websocket'
        ? yield* RpcClient.makeProtocolSocket({
            retryTransientErrors: true,
          }).pipe(
            Effect.provideServiceEffect(
              Socket.Socket,
              Socket.makeWebSocket(`${options.baseUrl.replace(/^http/, 'ws')}/_sync`),
            ),
            Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.json),
          )
        : yield* RpcClient.makeProtocolHttp(
            HttpClient.retryTransient(httpClient, {
              schedule: Schedule.exponentialBackoff10Sec,
            }),
          ).pipe(Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.ndjson))

    const client = yield* RpcClient.make(SyncRpcGroup).pipe(Effect.provideService(RpcClient.Protocol, protocol))

    yield* client.ping().pipe(
      Effect.isSuccess,
      Effect.flatMap((success) => SubscriptionRef.set(isConnected, success)),
      Effect.repeat(Schedule.spaced(10000)),
      Effect.forkScoped,
    )

    const backendId = yield* client.backendId({ storeId: options.storeId }).pipe(
      Effect.mapError((cause) => new UnknownError({ cause })),
      Effect.cached,
    )

    return ConnectionManager.of({
      connect: backendId,
      isConnected,
      ping: client.ping().pipe(
        Effect.mapError((cause) => new UnknownError({ cause })),
        Effect.timeout('10 seconds'),
      ),
      pull: ({ cursor, live }) =>
        backendId.pipe(
          Effect.flatMap(
            (backendId): Effect.Effect<EventSequenceNumber.Global.Type, UnknownError | BackendIdMismatchError> => {
              if (Option.isNone(cursor)) {
                return Effect.as(backendIdHelper.lazySet(backendId), EventSequenceNumber.Global.make(0))
              }
              const currentBackendId = Option.getOrThrow(backendIdHelper.get())
              if (backendId !== currentBackendId) {
                return Effect.fail(
                  new BackendIdMismatchError({
                    expected: backendId,
                    received: currentBackendId,
                  }),
                )
              }
              return Effect.succeed(cursor.value)
            },
          ),
          Effect.mapError((cause) => new InvalidPullError({ cause })),
          Effect.map((cursor) =>
            client.pull({
              storeId: options.storeId,
              clientId: options.clientId,
              cursor,
              live,
            }),
          ),
          Stream.unwrap,
          Stream.catchTag('RpcClientError', (e) =>
            Socket.isSocketError(e.cause) ? Stream.fail(new IsOfflineError({ cause: e.cause })) : Stream.die(e),
          ),
          Stream.map((batch) => ({
            batch: batch.map((eventEncoded) => ({
              eventEncoded,
              metadata: Option.none(),
            })),
            pageInfo: live ? SyncBackend.pageInfoMoreUnknown : SyncBackend.pageInfoNoMore,
          })),
        ),
      push: (batch) => {
        if (!ReadonlyArray.isNonEmptyReadonlyArray(batch)) {
          return Effect.void
        }
        return client
          .push({
            storeId: options.storeId,
            batch,
          })
          .pipe(Effect.catchTag('RpcClientError', Effect.die))
      },
    })
  })
}
