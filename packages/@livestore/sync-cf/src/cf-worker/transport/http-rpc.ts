import type { EventSequenceNumber } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, HttpApp, Layer, RpcSerialization, RpcServer, Stream } from '@livestore/utils/effect'

import { SyncHttpRpc } from '../../common/http-rpc-schema.ts'
import * as SyncMessage from '../../common/sync-message-types.ts'
import { makePull } from '../pull.ts'
import { makePush } from '../push.ts'
import type { MakeDurableObjectClassOptions, RpcSubscription, StoreId } from '../shared.ts'
import type { SyncStorage } from '../sync-storage.ts'

export interface HttpTransportHandlerOptions {
  ctx: CfTypes.DurableObjectState
  makeStorage: (storeId: StoreId) => SyncStorage
  doOptions: MakeDurableObjectClassOptions | undefined
  pushSemaphore: Effect.Semaphore
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
      () => webHandler(options.request as any as Request) as any as Promise<CfTypes.Response>,
    ).pipe(Effect.timeout(10000))
  }).pipe(Effect.withSpan('createHttpRpcHandler'))

const createHttpRpcLayer = (options: HttpTransportHandlerOptions) =>
  SyncHttpRpc.toLayer({
    'SyncHttpRpc.Pull': (req) =>
      Effect.gen(function* () {
        const pull = makePull({
          storage: options.makeStorage(req.storeId),
        })

        if (options.doOptions?.onPull) {
          yield* Effect.tryAll(() => options.doOptions!.onPull!(req, { storeId: req.storeId, payload: req.payload }))
        }

        return pull(req)
      }).pipe(
        Stream.unwrap,
        Stream.mapError((e) =>
          SyncMessage.SyncError.make({
            requestId: req.requestId,
            message: e.message,
            storeId: req.storeId,
          }),
        ),
      ),

    'SyncHttpRpc.Push': (req) =>
      Effect.gen(function* () {
        if (options.doOptions?.onPush) {
          yield* Effect.tryAll(() => options.doOptions!.onPush!(req, { storeId: req.storeId, payload: req.payload }))
        }

        const push = makePush({
          storage: options.makeStorage(req.storeId),
          requestId: req.requestId,
          ctx: options.ctx,
          // TODO: Implement proper respond
          respond: (message) => Effect.succeed(message),
          currentHeadRef: options.currentHeadRef,
          storeId: req.storeId,
          payload: undefined,
          rpcSubscriptions: options.rpcSubscriptions,
          pushSemaphore: options.pushSemaphore,
          options: options.doOptions,
        })

        yield* push(req)

        return SyncMessage.PushAck.make({ requestId: req.requestId })
      }).pipe(
        Effect.mapError((e) =>
          SyncMessage.SyncError.make({
            requestId: req.requestId,
            message: e.message,
            storeId: req.storeId,
          }),
        ),
      ),

    'SyncHttpRpc.Ping': (req) =>
      Effect.gen(function* () {
        // if (!options.onPing) {
        //   return Effect.succeed({ requestId: 'ping' as const })
        // }
        // return options.onPing({
        //   requestId: 'ping' as const,
        //   storeId: req.storeId,
        //   payload: req.payload,
        // })
        return SyncMessage.Pong.make({ requestId: req.requestId })
      }),
  }).pipe(
    Layer.provideMerge(RpcServer.layerProtocolHttp({ path: '/http-rpc' })),
    Layer.provideMerge(RpcSerialization.layerJson),
  )
