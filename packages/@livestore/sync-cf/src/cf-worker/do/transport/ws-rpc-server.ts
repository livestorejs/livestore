import { UnknownError } from '@livestore/common'
import { type CfTypes, WsContext } from '@livestore/common-cf'
import { omitUndefineds } from '@livestore/utils'
import { Effect, identity, Layer, Result, RpcServer, Schema, Stream } from '@livestore/utils/effect'

import { SyncWsRpc } from '../../../common/ws-rpc-schema.ts'
import { makePresenceServer, type PresenceServer } from '../../../presence/server.ts'
import { headersRecordToMap, WebSocketAttachmentSchema } from '../../shared.ts'
import * as DoCtx from '../layer.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export const makeRpcServer = ({ doSelf, doOptions }: Omit<DoCtx.DoCtxInput, 'from'>) => {
  const schemas = doOptions?.presence?.schemas
  const hasPresence = schemas !== undefined && Object.keys(schemas).length > 0

  let cached: PresenceServer | undefined

  const getServer = (storeId: string): Effect.Effect<PresenceServer> =>
    Effect.suspend(() => {
      if (cached !== undefined) return Effect.succeed(cached)
      if (!hasPresence) {
        return Effect.die('Presence RPC received but no presence schemas are configured')
      }
      return Effect.map(
        makePresenceServer(
          storeId,
          omitUndefineds({
            channels: Object.fromEntries(
              Object.entries(schemas!).map(([name, schema]) => [name, { schema }]),
            ),
            memberIdleTtlMs: doOptions?.presence?.room?.memberIdleTtlMs,
            sweepIntervalMs: doOptions?.presence?.room?.sweepIntervalMs,
            onJoin: doOptions?.presence?.onJoin,
            onUpdate: doOptions?.presence?.onUpdate,
            onLeave: doOptions?.presence?.onLeave,
            rateLimit: doOptions?.presence?.rateLimit,
          }),
        ),
        (server) => {
          cached = server
          return server
        },
      )
    })

  const handlersLayer = SyncWsRpc.toLayer({
    'SyncWsRpc.Pull': (req) =>
      Effect.gen(function* () {
        const headers = yield* getForwardedHeaders
        return makeEndingPullStream({ req, payload: req.payload, headers }).pipe(
          req.live === true ? Stream.concat(Stream.never) : identity,
          Stream.provide(DoCtx.layer({ doSelf, doOptions, from: { storeId: req.storeId } })),
          Stream.mapError((cause) =>
            cause._tag === 'UnknownError' || cause._tag === 'BackendIdMismatchError'
              ? cause
              : new UnknownError({ cause }),
          ),
        )
      }).pipe(Stream.unwrap),
    'SyncWsRpc.Push': (req) =>
      Effect.gen(function* () {
        const { doOptions: opts, storeId, ctx, env } = yield* DoCtx.DoCtx
        const headers = yield* getForwardedHeaders

        const push = makePush({ options: opts, storeId, payload: req.payload, headers, ctx, env })

        return yield* push(req)
      }).pipe(
        Effect.provide(DoCtx.layer({ doSelf, doOptions, from: { storeId: req.storeId } })),
        Effect.mapError((cause) =>
          cause._tag === 'UnknownError' || cause._tag === 'ServerAheadError' || cause._tag === 'BackendIdMismatchError'
            ? cause
            : new UnknownError({ cause }),
        ),
        Effect.tapCauseLogPretty,
      ),
    'SyncWsRpc.PresenceJoin': (req) =>
      Effect.gen(function* () {
        yield* bindPresenceClientId(req.clientId)
        const server = yield* getServer(req.storeId)
        const context = yield* presenceHookContext
        yield* server.join(omitUndefineds(req), context)
      }).pipe(UnknownError.mapToUnknownError),
    'SyncWsRpc.PresenceUpdate': (req) =>
      Effect.gen(function* () {
        yield* bindPresenceClientId(req.clientId)
        const server = yield* getServer(req.storeId)
        const context = yield* presenceHookContext
        const result = yield* server.update({ ...req, state: req.patch }, context).pipe(Effect.result)
        if (Result.isFailure(result)) {
          if (result.failure._tag === 'PresenceRateLimited') {
            if (server.rateLimitOnExceed === 'close') {
              const { ws } = yield* WsContext
              ws.close(4008, 'presence-rate-limited')
            }
            return
          }
          return yield* Effect.fail(result.failure)
        }
      }).pipe(UnknownError.mapToUnknownError),
    'SyncWsRpc.PresenceLeave': (req) =>
      Effect.gen(function* () {
        yield* bindPresenceClientId(req.clientId)
        const server = yield* getServer(req.storeId)
        const context = yield* presenceHookContext
        yield* server.leave(req, context)
      }).pipe(UnknownError.mapToUnknownError),
    'SyncWsRpc.PresenceSnapshots': (req) =>
      Effect.gen(function* () {
        const server = yield* getServer(req.storeId)
        return server.hub.snapshots(req.roomId, req.channel)
      }).pipe(Stream.unwrap, UnknownError.mapToUnknownErrorStream),
  })

  const onDisconnect = (ws: CfTypes.WebSocket): void | Promise<void> => {
    if (cached === undefined) return
    const clientId = readPresenceClientId(ws)
    if (clientId === undefined) return
    return Effect.runPromise(cached.leaveClient(clientId))
  }

  return {
    layer: RpcServer.layer(SyncWsRpc).pipe(Layer.provide(handlersLayer)),
    onDisconnect,
  }
}

const decodeAttachment = (ws: CfTypes.WebSocket) => {
  const attachment = ws.deserializeAttachment()
  return Schema.decodeUnknownResult(WebSocketAttachmentSchema)(attachment)
}

const readPresenceClientId = (ws: CfTypes.WebSocket): string | undefined => {
  const decoded = decodeAttachment(ws)
  if (Result.isFailure(decoded)) return undefined
  return decoded.success.presenceClientId
}

/** Bind this socket to a clientId on first join; reject spoofed later RPCs. */
const bindPresenceClientId = (clientId: string) =>
  Effect.gen(function* () {
    const { ws } = yield* WsContext
    const decoded = decodeAttachment(ws)
    if (Result.isFailure(decoded)) {
      return yield* new UnknownError({ cause: 'invalid-attachment', note: 'Failed to decode WebSocket attachment' })
    }
    const existing = decoded.success.presenceClientId
    if (existing !== undefined && existing !== clientId) {
      return yield* new UnknownError({
        cause: 'presence-client-mismatch',
        note: 'Socket is already bound to a different clientId',
      })
    }
    if (existing === undefined) {
      ws.serializeAttachment(
        Schema.encodeSync(WebSocketAttachmentSchema)({
          ...decoded.success,
          presenceClientId: clientId,
        }),
      )
    }
  })

const presenceHookContext = Effect.gen(function* () {
  const { ws } = yield* WsContext
  const decoded = decodeAttachment(ws)
  if (Result.isFailure(decoded)) {
    return {}
  }
  const headers = headersRecordToMap(decoded.success.headers)
  return {
    ...(decoded.success.payload !== undefined ? { payload: decoded.success.payload } : {}),
    ...(headers !== undefined ? { headers } : {}),
  }
})

const getForwardedHeaders = Effect.gen(function* () {
  const { ws } = yield* WsContext
  const decoded = decodeAttachment(ws)
  if (Result.isFailure(decoded) === true) {
    yield* Effect.logError('Failed to decode WebSocket attachment for forwarded headers', { error: decoded.failure })
    ws.close(1011, 'invalid-attachment')
    return yield* Effect.die('Invalid WebSocket attachment (headers decode failed)')
  }

  return headersRecordToMap(decoded.success.headers)
})
