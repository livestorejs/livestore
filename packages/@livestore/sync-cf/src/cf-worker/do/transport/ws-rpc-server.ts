import { InvalidPullError, InvalidPushError } from '@livestore/common'
import { Effect, identity, Layer, RpcServer, Stream } from '@livestore/utils/effect'
import { SyncWsRpc } from '../../../common/ws-rpc-schema.ts'
import { DoCtx, type DoCtxInput } from '../layer.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export const makeRpcServer = ({ doSelf, doOptions }: Omit<DoCtxInput, 'from'>) => {
  // TODO implement admin requests
  const handlersLayer = SyncWsRpc.toLayer({
    'SyncWsRpc.Pull': (req) =>
      makeEndingPullStream(req, req.payload).pipe(
        // Needed to keep the stream alive on the client side for phase 2 (i.e. not send the `Exit` stream RPC message)
        req.live ? Stream.concat(Stream.never) : identity,
        Stream.provideLayer(DoCtx.Default({ doSelf, doOptions, from: { storeId: req.storeId } })),
        Stream.mapError((cause) => (cause._tag === 'InvalidPullError' ? cause : InvalidPullError.make({ cause }))),
        // Stream.tapErrorCause(Effect.log),
      ),
    'SyncWsRpc.Push': (req) =>
      Effect.gen(function* () {
        const { doOptions, storeId, ctx, env } = yield* DoCtx

        const push = makePush({ options: doOptions, storeId, payload: req.payload, ctx, env })

        return yield* push(req)
      }).pipe(
        Effect.provide(DoCtx.Default({ doSelf, doOptions, from: { storeId: req.storeId } })),
        Effect.mapError((cause) => (cause._tag === 'InvalidPushError' ? cause : InvalidPushError.make({ cause }))),
        Effect.tapCauseLogPretty,
      ),
  })

  return RpcServer.layer(SyncWsRpc).pipe(Layer.provide(handlersLayer))
}
