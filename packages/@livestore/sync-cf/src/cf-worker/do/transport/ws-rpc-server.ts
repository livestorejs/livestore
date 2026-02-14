import { InvalidPullError, InvalidPushError, UnknownError } from '@livestore/common'
import { WsContext } from '@livestore/common-cf'
import { Effect, identity, Layer, RpcServer, Schema, Stream } from '@livestore/utils/effect'

import { SyncWsRpc } from '../../../common/ws-rpc-schema.ts'
import { headersRecordToMap, WebSocketAttachmentSchema } from '../../shared.ts'
import { DoCtx, type DoCtxInput } from '../layer.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export const makeRpcServer = ({ doSelf, doOptions }: Omit<DoCtxInput, 'from'>) => {
  const handlersLayer = SyncWsRpc.toLayer({
    'SyncWsRpc.Pull': (req) =>
      Effect.gen(function* () {
        const headers = yield* getForwardedHeaders
        return makeEndingPullStream({ req, payload: req.payload, headers }).pipe(
          // Needed to keep the stream alive on the client side for phase 2 (i.e. not send the `Exit` stream RPC message)
          req.live ? Stream.concat(Stream.never) : identity,
          Stream.provideLayer(DoCtx.Default({ doSelf, doOptions, from: { storeId: req.storeId } })),
          Stream.mapError((cause) =>
            cause._tag === 'InvalidPullError' ? cause : InvalidPullError.make({ cause: new UnknownError({ cause }) }),
          ),
        )
      }).pipe(Stream.unwrap),
    'SyncWsRpc.Push': (req) =>
      Effect.gen(function* () {
        const { doOptions, storeId, ctx, env } = yield* DoCtx
        const headers = yield* getForwardedHeaders

        const push = makePush({ options: doOptions, storeId, payload: req.payload, headers, ctx, env })

        return yield* push(req)
      }).pipe(
        Effect.provide(DoCtx.Default({ doSelf, doOptions, from: { storeId: req.storeId } })),
        Effect.mapError((cause) => (cause._tag === 'InvalidPushError' ? cause : InvalidPushError.make({ cause }))),
        Effect.tapCauseLogPretty,
      ),
  })

  return RpcServer.layer(SyncWsRpc).pipe(Layer.provide(handlersLayer))
}

/** Extracts forwarded headers from the WebSocket attachment */
const getForwardedHeaders = Effect.gen(function* () {
  const { ws } = yield* WsContext
  const attachment = ws.deserializeAttachment()
  const decoded = Schema.decodeUnknownEither(WebSocketAttachmentSchema)(attachment)
  if (decoded._tag === 'Left') {
    yield* Effect.logError('Failed to decode WebSocket attachment for forwarded headers', { error: decoded.left })
    ws.close(1011, 'invalid-attachment')
    return yield* Effect.die('Invalid WebSocket attachment (headers decode failed)')
  }

  const headers = headersRecordToMap(decoded.right.headers)
  return headers
})
