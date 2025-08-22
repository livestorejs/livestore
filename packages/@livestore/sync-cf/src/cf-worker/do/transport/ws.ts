import { UnexpectedError } from '@livestore/common'
import type { EventSequenceNumber } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { Effect, Layer, RpcServer, Stream } from '@livestore/utils/effect'
import { SyncMessage } from '../../../common/mod.ts'
import { SyncWsRpc } from '../../../common/ws-rpc-schema.ts'
import type { Env, MakeDurableObjectClassOptions, RpcSubscription, StoreId } from '../../shared.ts'
import { makePull } from '../pull.ts'
import { makePush } from '../push.ts'
import { makeStorage } from '../sync-storage.ts'

export const makeRpcServer = ({
  options,
  ctx,
  env,
  rpcSubscriptions,
  pushSemaphore,
  currentHeadRef,
}: {
  options: MakeDurableObjectClassOptions | undefined
  ctx: CfTypes.DurableObjectState
  env: Env
  rpcSubscriptions: Map<StoreId, RpcSubscription>
  pushSemaphore: Effect.Semaphore
  currentHeadRef: { current: EventSequenceNumber.GlobalEventSequenceNumber | 'uninitialized' }
}) => {
  const handlersLayer = SyncWsRpc.toLayer({
    'SyncWsRpc.Pull': (req) =>
      Effect.gen(function* () {
        const { storeId, payload } = req
        const storage = makeStorage(ctx, env, storeId)

        if (options?.onPull) {
          yield* Effect.tryAll(() => options.onPull!(req, { storeId, payload })).pipe(
            UnexpectedError.mapToUnexpectedError,
          )
        }

        const pull = makePull({ storage })

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
        Stream.mapError((cause) => SyncMessage.SyncError.make({ cause, storeId: req.storeId })),
      ),
    'SyncWsRpc.Push': (req) =>
      // TODO use `ctx.blockConcurrencyWhile` to block concurrent push requests
      Effect.gen(function* () {
        const { storeId, payload } = req
        const storage = makeStorage(ctx, env, storeId)

        if (options?.onPush) {
          yield* Effect.tryAll(() => options.onPush!(req, { storeId, payload })).pipe(
            UnexpectedError.mapToUnexpectedError,
          )
        }

        const push = makePush({
          storage,
          options,
          rpcSubscriptions,
          pushSemaphore,
          currentHeadRef,
          storeId,
          payload,
          ctx,
        })

        return yield* push(req)
        // TODO implement admin requests
      }).pipe(
        Effect.mapError((cause) =>
          cause._tag === 'LiveStore.UnexpectedError'
            ? SyncMessage.SyncError.make({ cause, storeId: req.storeId })
            : cause,
        ),
      ),
  })

  return RpcServer.layer(SyncWsRpc).pipe(Layer.provide(handlersLayer))
}
