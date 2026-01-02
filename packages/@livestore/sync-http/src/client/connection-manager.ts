import { type InvalidPullError, type InvalidPushError, SyncBackend } from '@livestore/common'
import type { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import {
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

    readonly connect: Effect.Effect<void, never, Scope.Scope>

    readonly ping: Effect.Effect<void, never>

    readonly pull: (options: {
      readonly cursor: EventSequenceNumber.Global.Type
      readonly live: boolean
    }) => Stream.Stream<SyncBackend.PullResItem, InvalidPullError>

    readonly push: (events: ReadonlyArray<LiveStoreEvent.Global.Encoded>) => Effect.Effect<void, InvalidPushError>
  }
>() {
  static readonly make = Effect.fnUntraced(function* (options: {
    readonly baseUrl: string
    readonly storeId: string
    readonly protocol: 'websocket' | 'http'
  }) {
    const isConnected = yield* SubscriptionRef.make(false)
    const httpClient = yield* HttpClient.HttpClient

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

    return ConnectionManager.of({
      connect: Effect.void,
      isConnected,
      ping: Effect.orDie(client.ping()),
      pull: ({ cursor, live }) =>
        client.pull({ storeId: options.storeId, cursor, live }).pipe(
          Stream.catchTag('RpcClientError', (e) => Stream.die(e)),
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
