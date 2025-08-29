import { InvalidPullError, InvalidPushError } from '@livestore/common'
import { toDurableObjectHandler } from '@livestore/common-cf'
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
import { DoCtx, type DoCtxInput } from '../layer.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export interface DoRpcHandlerOptions {
  payload: Uint8Array<ArrayBuffer>
  input: Omit<DoCtxInput, 'from'>
}

export const createDoRpcHandler = (options: DoRpcHandlerOptions) =>
  Effect.gen(this, function* () {
    const { payload, input } = options
    // const { rpcSubscriptions, backendId, doOptions, ctx, env } = yield* DoCtx

    // TODO add admin RPCs
    const RpcLive = SyncDoRpc.toLayer({
      'SyncDoRpc.Ping': (_req) => {
        return Effect.succeed(SyncMessage.Pong.make({}))
      },
      'SyncDoRpc.Pull': (req, { headers }) =>
        Effect.gen(this, function* () {
          const { rpcSubscriptions } = yield* DoCtx

          // TODO rename `req.rpcContext` to something more appropriate
          if (req.rpcContext) {
            rpcSubscriptions.set(req.storeId, {
              storeId: req.storeId,
              payload: req.payload,
              subscribedAt: Date.now(),
              requestId: Headers.get(headers, 'x-rpc-request-id').pipe(Option.getOrThrow),
              callerContext: req.rpcContext.callerContext,
            })
          }

          return makeEndingPullStream(req, req.payload)
        }).pipe(
          Stream.unwrap,
          Stream.map((res) => ({
            ...res,
            rpcRequestId: Headers.get(headers, 'x-rpc-request-id').pipe(Option.getOrThrow),
          })),
          Stream.provideLayer(DoCtx.Default({ ...input, from: { storeId: req.storeId } })),
          Stream.mapError((cause) => (cause._tag === 'InvalidPullError' ? cause : InvalidPullError.make({ cause }))),
          Stream.tapErrorCause(Effect.log),
        ),
      'SyncDoRpc.Push': (req) =>
        Effect.gen(this, function* () {
          const { doOptions, ctx, env, storeId } = yield* DoCtx
          const push = makePush({ storeId, payload: req.payload, options: doOptions, ctx, env })

          return yield* push(req)
        }).pipe(
          Effect.provide(DoCtx.Default({ ...input, from: { storeId: req.storeId } })),
          Effect.mapError((cause) => (cause._tag === 'InvalidPushError' ? cause : InvalidPushError.make({ cause }))),
          Effect.tapCauseLogPretty,
        ),
    })

    const handler = toDurableObjectHandler(SyncDoRpc, {
      layer: Layer.mergeAll(RpcLive, RpcSerialization.layerJson, HttpServer.layerContext).pipe(
        Layer.provide(Logger.consoleWithThread('SyncDo')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    })

    return yield* handler(payload)
  }).pipe(Effect.withSpan('createDoRpcHandler'))
