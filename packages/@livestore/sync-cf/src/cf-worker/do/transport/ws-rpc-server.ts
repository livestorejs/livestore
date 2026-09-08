import { UnknownError } from '@livestore/common'
import { WsContext } from '@livestore/common-cf'
import { Effect, identity, Layer, Result, RpcServer, Schema, Stream } from '@livestore/utils/effect'

import { SyncWsRpc } from '../../../common/ws-rpc-schema.ts'
import { headersRecordToMap, WebSocketAttachmentSchema } from '../../shared.ts'
import * as DoCtx from '../layer.ts'
import { type makeObservability, rpcSpanOptions } from '../observability.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export const makeRpcServer = ({
  doSelf,
  doOptions,
  observability,
}: Omit<DoCtx.DoCtxInput, 'from'> & { observability: ReturnType<typeof makeObservability> }) => {
  const handlersLayer = SyncWsRpc.toLayer({
    'SyncWsRpc.Pull': (req) =>
      Effect.gen(function* () {
        const spanOptions = yield* rpcSpanOptions
        const headers = yield* getForwardedHeaders
        return makeEndingPullStream({ req, payload: req.payload, headers }).pipe(
          Stream.provide(DoCtx.layer({ doSelf, doOptions, from: { storeId: req.storeId } })),
          Stream.mapError((cause) =>
            cause._tag === 'UnknownError' || cause._tag === 'BackendIdMismatchError'
              ? cause
              : new UnknownError({ cause }),
          ),
          Stream.withSpan('RpcServer.SyncWsRpc.Pull', spanOptions),
        )
      }).pipe(
        Stream.unwrap,
        // Drain finite history before entering the live phase, which survives DO hibernation.
        observability.stream,
        // Keep the client subscription open without retaining an exporter scope or timer.
        req.live === true ? Stream.concat(Stream.never) : identity,
      ),
    'SyncWsRpc.Push': (req) =>
      Effect.flatMap(rpcSpanOptions, (spanOptions) =>
        Effect.gen(function* () {
          const { doOptions, storeId, ctx, env } = yield* DoCtx.DoCtx
          const headers = yield* getForwardedHeaders

          const push = makePush({ options: doOptions, storeId, payload: req.payload, headers, ctx, env })

          return yield* push(req)
        }).pipe(
          Effect.provide(DoCtx.layer({ doSelf, doOptions, from: { storeId: req.storeId } })),
          Effect.mapError((cause) =>
            cause._tag === 'UnknownError' ||
            cause._tag === 'ServerAheadError' ||
            cause._tag === 'BackendIdMismatchError'
              ? cause
              : new UnknownError({ cause }),
          ),
          Effect.tapCauseLogPretty,
          Effect.withSpan('RpcServer.SyncWsRpc.Push', spanOptions),
        ),
      ).pipe(observability.effect),
  })

  return RpcServer.layer(SyncWsRpc).pipe(Layer.provide(handlersLayer))
}

/** Extracts forwarded headers from the WebSocket attachment */
const getForwardedHeaders = Effect.gen(function* () {
  const { ws } = yield* WsContext
  const attachment = ws.deserializeAttachment()
  const decoded = Schema.decodeUnknownResult(WebSocketAttachmentSchema)(attachment)
  if (Result.isFailure(decoded) === true) {
    yield* Effect.logError('Failed to decode WebSocket attachment for forwarded headers', { error: decoded.failure })
    ws.close(1011, 'invalid-attachment')
    return yield* Effect.die('Invalid WebSocket attachment (headers decode failed)')
  }

  const headers = headersRecordToMap(decoded.success.headers)
  return headers
})
