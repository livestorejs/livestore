import { UnknownError } from '@livestore/common'
import { type CfTypes, type SyncUpdateCallback, toDurableObjectHandler } from '@livestore/common-cf'
import { Effect, Headers, Option, Stream } from '@livestore/utils/effect'

import { SyncDoRpc } from '../../../common/do-rpc-schema.ts'
import { rpcSubscriptionKeyPrefix, type RpcSubscription } from '../../shared.ts'
import * as DoCtx from '../layer.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export interface DoRpcHandlerOptions {
  payload: Uint8Array<ArrayBuffer>
  /** Persistent stub the client passed alongside a live pull; stored with the subscription row. */
  callback?: SyncUpdateCallback | undefined
  input: Omit<DoCtx.DoCtxInput, 'from'>
}

export const createDoRpcHandler = (
  options: DoRpcHandlerOptions,
): Effect.Effect<Uint8Array<ArrayBuffer> | CfTypes.ReadableStream> =>
  Effect.gen({ self: this }, function* () {
    const { payload, callback, input } = options

    // TODO add admin RPCs
    const RpcLive = SyncDoRpc.toLayer({
      'SyncDoRpc.Ping': () => Effect.void,
      'SyncDoRpc.Unsubscribe': (req) =>
        Effect.sync(() => {
          input.doSelf.ctx.storage.kv.delete(`${rpcSubscriptionKeyPrefix}${req.subscriptionId}`)
        }),
      'SyncDoRpc.Pull': (req, { headers }) =>
        Effect.gen({ self: this }, function* () {
          const { ctx } = yield* DoCtx.DoCtx

          if (req.live !== undefined) {
            if (callback === undefined) {
              return yield* new UnknownError({
                cause: 'A live DO-RPC pull needs a callback stub alongside the payload',
              })
            }
            const subscription: RpcSubscription = {
              storeId: req.storeId,
              subscribedAt: Date.now(),
              requestId: Headers.get(headers, 'x-rpc-request-id').pipe(Option.getOrThrow),
              callback,
              ...(req.payload !== undefined ? { payload: req.payload } : {}),
            }
            // The DO's synchronous KV storage is the single source of truth, so the row (stub included) outlives
            // backend reconstruction. The client's `[restore]` refuses deliveries for a superseded id.
            ctx.storage.kv.put(`${rpcSubscriptionKeyPrefix}${req.live.subscriptionId}`, subscription)
          }

          // DO-RPC doesn't have HTTP headers context - headers are undefined
          return makeEndingPullStream({ req, payload: req.payload, headers: undefined })
        }).pipe(
          Stream.unwrap,
          Stream.map((res) => ({
            ...res,
            rpcRequestId: Headers.get(headers, 'x-rpc-request-id').pipe(Option.getOrThrow),
          })),
          Stream.provide(DoCtx.layer({ ...input, from: { storeId: req.storeId } })),
          Stream.mapError((cause) =>
            cause._tag === 'UnknownError' || cause._tag === 'BackendIdMismatchError'
              ? cause
              : new UnknownError({ cause }),
          ),
          Stream.tapCause(Effect.log),
        ),
      'SyncDoRpc.Push': (req) =>
        Effect.gen({ self: this }, function* () {
          const { doOptions, ctx, env, storeId } = yield* DoCtx.DoCtx
          // DO-RPC doesn't have HTTP headers context - headers are undefined
          const push = makePush({ storeId, payload: req.payload, headers: undefined, options: doOptions, ctx, env })

          return yield* push(req)
        }).pipe(
          Effect.provide(DoCtx.layer({ ...input, from: { storeId: req.storeId } })),
          Effect.mapError((cause) =>
            cause._tag === 'UnknownError' ||
            cause._tag === 'ServerAheadError' ||
            cause._tag === 'BackendIdMismatchError'
              ? cause
              : new UnknownError({ cause }),
          ),
          Effect.tapCauseLogPretty,
        ),
    })

    const handler = toDurableObjectHandler(SyncDoRpc, {
      layer: RpcLive,
    })

    return yield* handler(payload).pipe(Effect.annotateLogs({ thread: 'SyncDo' }))
  }).pipe(Effect.withSpan('createDoRpcHandler'))
