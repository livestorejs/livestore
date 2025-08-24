import { SyncBackend } from '@livestore/common'
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

    // TODO add admin RPCs
    const RpcLive = SyncDoRpc.toLayer({
      'SyncDoRpc.Ping': (_req) => {
        return Effect.succeed(SyncMessage.Pong.make({}))
      },
      'SyncDoRpc.Pull': (req, headers) =>
        Effect.gen(this, function* () {
          yield* ensureStorageCache(req.storeId)
          const pull = makeEndingPullStream({
            storage: makeStorage(ctx, env, req.storeId),
            doOptions: options.doOptions,
            storeId: req.storeId,
            payload: req.payload,
          })

          // TODO rename `req.rpcContext` to something more appropriate
          if (req.rpcContext) {
            rpcSubscriptions.set(req.storeId, {
              // clientId: req.clientId,
              storeId: req.storeId,
              payload: req.payload,
              subscribedAt: Date.now(),
              requestId: Headers.get(headers, 'x-rpc-request-id').pipe(Option.getOrThrow),
              callerContext: req.rpcContext.callerContext,
            })
          }

          return pull(req)
        }).pipe(
          Stream.unwrap,
          Stream.emitIfEmpty(SyncBackend.pullResItemEmpty<SyncMessage.SyncMetadata>()),
          Stream.map((res) => ({
            ...res,
            rpcRequestId: Headers.get(headers, 'x-rpc-request-id').pipe(Option.getOrThrow),
          })),
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
            rpcSubscriptions,
            options: options.doOptions,
          })

          return yield* push(req)
        }),
    })

    const handler = toDurableObjectHandler(SyncDoRpc, {
      layer: Layer.mergeAll(RpcLive, RpcSerialization.layerJson, HttpServer.layerContext).pipe(
        Layer.provide(Logger.consoleWithThread('SyncDo')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    })

    return yield* handler(payload)
  }).pipe(Effect.withSpan('createDoRpcHandler'))
