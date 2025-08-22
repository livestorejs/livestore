import type { EventSequenceNumber } from '@livestore/common/schema'
import { type CfTypes, toDurableObjectHandler } from '@livestore/common-cf'
import {
  Effect,
  Headers,
  HttpServer,
  Layer,
  Logger,
  LogLevel,
  Option,
  RpcSerialization,
  Schedule,
  Stream,
} from '@livestore/utils/effect'
import { SyncDoRpc } from '../../../common/do-rpc-schema.ts'
import { SyncMessage } from '../../../common/mod.ts'
import type { Env, MakeDurableObjectClassOptions, RpcSubscription, StoreId } from '../../shared.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'
import { makeStorage } from '../sync-storage.ts'

export interface DoRpcHandlerOptions {
  ctx: CfTypes.DurableObjectState
  env: Env
  doOptions: MakeDurableObjectClassOptions | undefined
  rpcSubscriptions: Map<StoreId, RpcSubscription>
  currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' }
  payload: Uint8Array<ArrayBuffer>
  ensureStorageCache: (storeId: StoreId) => Effect.Effect<void>
}

export const createDoRpcHandler = (options: DoRpcHandlerOptions) =>
  Effect.gen(this, function* () {
    const { ctx, env, rpcSubscriptions, currentHeadRef, payload, ensureStorageCache } = options

    const RpcLive = SyncDoRpc.toLayer({
      'SyncDoRpc.Ping': (_req) => {
        return Effect.succeed(SyncMessage.Pong.make({}))
      },
      'SyncDoRpc.Pull': (req) =>
        Effect.gen(this, function* () {
          yield* ensureStorageCache(req.storeId)
          const pull = makeEndingPullStream({
            storage: makeStorage(ctx, env, req.storeId),
            doOptions: options.doOptions,
            storeId: req.storeId,
            payload: req.payload,
            emitEmptyBatch: false,
          })

          return pull(req)
        }).pipe(
          Stream.unwrap,
          Stream.mapError((cause) => SyncMessage.SyncError.make({ cause, storeId: req.storeId })),
        ),
      'SyncDoRpc.Push': (req) =>
        Effect.gen(this, function* () {
          yield* ensureStorageCache(req.storeId)

          const push = makePush({
            storage: makeStorage(ctx, env, req.storeId),
            ctx: ctx,
            env,
            currentHeadRef,
            storeId: req.storeId,
            payload: undefined,
            rpcSubscriptions: rpcSubscriptions,
            options: options.doOptions,
          })

          return yield* push(req)
        }),
      'SyncDoRpc.Subscribe': (req, headers) =>
        Effect.gen(this, function* () {
          yield* ensureStorageCache(req.storeId)

          // const subscribe = makeSubscribe({ storage: makeStorage(ctx, env, req.storeId), requestId: 'ping' })

          rpcSubscriptions.set(req.callerContext.durableObjectId, {
            clientId: req.clientId,
            storeId: req.storeId,
            payload: req.payload,
            subscribedAt: Date.now(),
            requestId: Headers.get(headers, 'x-rpc-request-id').pipe(Option.getOrThrow),
            callerContext: req.callerContext,
          })

          // const res = yield* subscribe(req)

          // TODO get rid of "hard coded" 1s interval in favour of proper reactive subscription
          return Stream.succeed('ok').pipe(Stream.repeat(Schedule.spaced(1000)))
        }).pipe(Stream.unwrap),
      'SyncDoRpc.Unsubscribe': (req) =>
        Effect.gen(this, function* () {
          yield* ensureStorageCache(req.storeId)

          rpcSubscriptions.delete(req.durableObjectId)
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
