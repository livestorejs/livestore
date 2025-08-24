import { SyncBackend, UnexpectedError } from '@livestore/common'
import type { EventSequenceNumber } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, identity, Layer, RpcServer, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../../../common/mod.ts'
import { SyncWsRpc } from '../../../common/ws-rpc-schema.ts'
import type { Env, MakeDurableObjectClassOptions, RpcSubscription, StoreId } from '../../shared.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'
import { makeStorage } from '../sync-storage.ts'

export const makeRpcServer = ({
  options,
  ctx,
  env,
  rpcSubscriptions,
  currentHeadRef,
}: {
  options: MakeDurableObjectClassOptions | undefined
  ctx: CfTypes.DurableObjectState
  env: Env
  rpcSubscriptions: Map<StoreId, RpcSubscription>
  currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' }
}) => {
  // TODO implement admin requests
  const handlersLayer = SyncWsRpc.toLayer({
    'SyncWsRpc.Pull': (req) =>
      Effect.gen(function* () {
        const { storeId, payload } = req
        const storage = makeStorage(ctx, env, storeId)

        const pull = makeEndingPullStream({ storage, doOptions: options, storeId, payload })

        return pull(req).pipe(
          Stream.tap(
            Effect.fn(function* (res) {
              if (options?.onPullRes) {
                yield* Effect.tryAll(() => options.onPullRes!(res)).pipe(UnexpectedError.mapToUnexpectedError)
              }
            }),
          ),
        )
      }).pipe(
        Stream.unwrap,
        Stream.emitIfEmpty(SyncBackend.pullResItemEmpty<SyncMessage.SyncMetadata>()),
        // Needed to keep the stream alive on the client side for phase 2 (i.e. not send the `Exit` stream RPC message)
        req.live ? Stream.concat(Stream.never) : identity,
        Stream.mapError((cause) => SyncMessage.SyncError.make({ cause, storeId: req.storeId })),
      ),
    'SyncWsRpc.Push': (req) =>
      Effect.gen(function* () {
        const { storeId, payload } = req
        const storage = makeStorage(ctx, env, storeId)

        const push = makePush({
          storage,
          options,
          rpcSubscriptions,
          currentHeadRef,
          storeId,
          payload,
          ctx,
          env,
        })

        return yield* push(req)
      }),
  })

  return RpcServer.layer(SyncWsRpc).pipe(Layer.provide(handlersLayer))
}
