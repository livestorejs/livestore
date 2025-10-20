import type { CfTypes } from '@livestore/common-cf'
import { Effect, HttpApp, Layer, RpcSerialization, RpcServer } from '@livestore/utils/effect'
import { SyncHttpRpc } from '../../../common/http-rpc-schema.ts'
import * as SyncMessage from '../../../common/sync-message-types.ts'
import { DoCtx } from '../layer.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export const createHttpRpcHandler = ({
  request,
  responseHeaders,
}: {
  request: CfTypes.Request
  responseHeaders?: Record<string, string>
}) =>
  Effect.gen(function* () {
    const handlerLayer = createHttpRpcLayer
    const httpApp = RpcServer.toHttpApp(SyncHttpRpc).pipe(Effect.provide(handlerLayer))
    const webHandler = yield* httpApp.pipe(Effect.map(HttpApp.toWebHandler))

    const response = yield* Effect.promise(
      () => webHandler(request as TODO as Request) as TODO as Promise<CfTypes.Response>,
    ).pipe(Effect.timeout(10000))

    if (responseHeaders !== undefined) {
      for (const [key, value] of Object.entries(responseHeaders)) {
        response.headers.set(key, value)
      }
    }

    return response
  }).pipe(Effect.withSpan('createHttpRpcHandler'))

const createHttpRpcLayer =
  // TODO implement admin requests
  SyncHttpRpc.toLayer({
    'SyncHttpRpc.Pull': (req) => makeEndingPullStream(req, req.payload),

    'SyncHttpRpc.Push': (req) =>
      Effect.gen(function* () {
        const { ctx, env, doOptions, storeId } = yield* DoCtx
        const push = makePush({ payload: undefined, options: doOptions, storeId, ctx, env })

        return yield* push(req)
      }),

    'SyncHttpRpc.Ping': () => Effect.succeed(SyncMessage.Pong.make({})),
  }).pipe(
    Layer.provideMerge(RpcServer.layerProtocolHttp({ path: '/http-rpc' })),
    Layer.provideMerge(RpcSerialization.layerJson),
  )
