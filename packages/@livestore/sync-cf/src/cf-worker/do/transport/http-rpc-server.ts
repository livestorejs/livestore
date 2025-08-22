import type { EventSequenceNumber } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, HttpApp, Layer, RpcSerialization, RpcServer, Stream } from '@livestore/utils/effect'
import { SyncHttpRpc } from '../../../common/http-rpc-schema.ts'
import * as SyncMessage from '../../../common/sync-message-types.ts'
import type { Env, MakeDurableObjectClassOptions, RpcSubscription, StoreId } from '../../shared.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'
import type { SyncStorage } from '../sync-storage.ts'

export interface HttpTransportHandlerOptions {
  ctx: CfTypes.DurableObjectState
  env: Env
  makeStorage: (storeId: StoreId) => Effect.Effect<SyncStorage>
  doOptions: MakeDurableObjectClassOptions | undefined
  rpcSubscriptions: Map<StoreId, RpcSubscription>
  currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' }
  request: CfTypes.Request
}

/**
 * Creates an HTTP RPC web handler for the sync provider
 */
export const createHttpRpcHandler = (options: HttpTransportHandlerOptions) =>
  Effect.gen(function* () {
    const handlerLayer = createHttpRpcLayer(options)
    const httpApp = RpcServer.toHttpApp(SyncHttpRpc).pipe(Effect.provide(handlerLayer))
    const webHandler = yield* httpApp.pipe(Effect.map(HttpApp.toWebHandler))

    return yield* Effect.promise(
      () => webHandler(options.request as TODO as Request) as TODO as Promise<CfTypes.Response>,
    ).pipe(Effect.timeout(10000))
  }).pipe(Effect.withSpan('createHttpRpcHandler'))

const createHttpRpcLayer = (options: HttpTransportHandlerOptions) =>
  // TODO implement admin requests
  SyncHttpRpc.toLayer({
    'SyncHttpRpc.Pull': (req) =>
      Effect.gen(function* () {
        const storage = yield* options.makeStorage(req.storeId)

        const pull = makeEndingPullStream({
          storage,
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

    'SyncHttpRpc.Push': (req) =>
      Effect.gen(function* () {
        const storage = yield* options.makeStorage(req.storeId)
        const push = makePush({
          storage,
          ctx: options.ctx,
          env: options.env,
          currentHeadRef: options.currentHeadRef,
          storeId: req.storeId,
          payload: undefined,
          rpcSubscriptions: options.rpcSubscriptions,
          options: options.doOptions,
        })

        return yield* push(req)
      }),

    'SyncHttpRpc.Ping': () => Effect.succeed(SyncMessage.Pong.make({})),
  }).pipe(
    Layer.provideMerge(RpcServer.layerProtocolHttp({ path: '/http-rpc' })),
    Layer.provideMerge(RpcSerialization.layerJson),
  )
