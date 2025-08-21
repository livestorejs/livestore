import type { EventSequenceNumber } from '@livestore/common/schema'
import { type CfTypes, toDurableObjectHandler } from '@livestore/common-cf'
import {
  Effect,
  HttpServer,
  Layer,
  Logger,
  LogLevel,
  RpcSerialization,
  Schedule,
  Stream,
} from '@livestore/utils/effect'
import { SyncDoRpc } from '../../../common/do-rpc-schema.ts'
import { SyncMessage } from '../../../common/mod.ts'
import type { Env, MakeDurableObjectClassOptions, RpcSubscription, StoreId } from '../../shared.ts'
import { makePull } from '../pull.ts'
import { makePush } from '../push.ts'
import { makeStorage } from '../sync-storage.ts'

export interface DoRpcHandlerOptions {
  ctx: CfTypes.DurableObjectState
  env: Env
  doOptions: MakeDurableObjectClassOptions | undefined
  pushSemaphore: Effect.Semaphore
  rpcSubscriptions: Map<StoreId, RpcSubscription>
  currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' }
  payload: Uint8Array<ArrayBuffer>
  ensureStorageCache: (storeId: StoreId) => void
}

export const createDoRpcHandler = (options: DoRpcHandlerOptions) =>
  Effect.gen(this, function* () {
    const { ctx, env, pushSemaphore, rpcSubscriptions, currentHeadRef, payload, ensureStorageCache } = options

    const RpcLive = SyncDoRpc.toLayer({
      'SyncDoRpc.Ping': (_req) => {
        return Effect.succeed(SyncMessage.Pong.make({ requestId: 'ping' }))
      },
      'SyncDoRpc.Pull': (req) =>
        Effect.gen(this, function* () {
          ensureStorageCache(req.storeId)
          const pull = makePull({ storage: makeStorage(ctx, env, req.storeId) })

          return pull(req)
        }).pipe(
          Stream.unwrap,
          Stream.mapError((cause) => SyncMessage.SyncError.make({ cause, storeId: req.storeId })),
        ),
      'SyncDoRpc.Push': (req) =>
        Effect.gen(this, function* () {
          ensureStorageCache(req.storeId)

          const push = makePush({
            storage: makeStorage(ctx, env, req.storeId),
            requestId: req.requestId,
            ctx: ctx,
            currentHeadRef,
            storeId: req.storeId,
            payload: undefined,
            rpcSubscriptions: rpcSubscriptions,
            pushSemaphore: pushSemaphore,
            options: options.doOptions,
          })

          return yield* push(req)
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === 'LiveStore.UnexpectedError'
              ? SyncMessage.SyncError.make({ cause, storeId: req.storeId })
              : cause,
          ),
        ),
      'SyncDoRpc.Subscribe': (req) =>
        Effect.gen(this, function* () {
          ensureStorageCache(req.storeId)

          // const subscribe = makeSubscribe({ storage: makeStorage(ctx, env, req.storeId), requestId: 'ping' })

          rpcSubscriptions.set(req.durableObjectId, {
            clientId: req.clientId,
            storeId: req.storeId,
            payload: req.payload,
            subscribedAt: Date.now(),
          })

          // const res = yield* subscribe(req)

          // TODO get rid of "hard coded" 1s interval in favour of proper reactive subscription
          return Stream.succeed('ok').pipe(Stream.repeat(Schedule.spaced(1000)))
        }).pipe(Stream.unwrap),
      'SyncDoRpc.Unsubscribe': (req) =>
        Effect.gen(this, function* () {
          ensureStorageCache(req.storeId)
        }),
    })

    const handler = toDurableObjectHandler(SyncDoRpc, {
      layer: Layer.mergeAll(RpcLive, RpcSerialization.layerJson, HttpServer.layerContext).pipe(
        Layer.provide(Logger.prettyWithThread('SyncDo')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    })

    return yield* handler(payload)
  }).pipe(Effect.withSpan('createDoRpcHandler'))
