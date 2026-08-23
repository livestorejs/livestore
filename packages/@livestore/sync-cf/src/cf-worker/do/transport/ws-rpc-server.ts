import { UnknownError } from '@livestore/common'
import { WsContext } from '@livestore/common-cf'
import { Effect, identity, Layer, Result, RpcServer, Schema, Stream } from '@livestore/utils/effect'

import { SyncWsRpc } from '../../../common/ws-rpc-schema.ts'
import {
  headersRecordToMap,
  type MakeDurableObjectClassOptions,
  WebSocketAttachmentSchema,
} from '../../shared.ts'
import { makePresenceRoom, type PresenceRoom } from '../../../presence/room.ts'
import * as DoCtx from '../layer.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export const makeRpcServer = ({ doSelf, doOptions }: Omit<DoCtx.DoCtxInput, 'from'>) => {
  /**
   * Ephemeral presence channels hosted by this party — single-party model: the
   * same DO that arbitrates the durable eventlog also fans out presence.
   * Channels + their schemas are declared once via
   * `makeDurableObject({ presence: { schemas } })`; never persisted, pruned by
   * idle TTL. Undefined when the host declares no channels.
   */
  const schemas = doOptions?.presence?.schemas
  const hasPresence = schemas !== undefined && Object.keys(schemas).length > 0

  // One room per DO instance (the party), cached with its sweeper scope.
  // Lazily created once per DO instance; the room's sweeper runs detached so
  // no scope management is needed here.
  let cachedRoom: PresenceRoom | undefined

  const getRoom = (): Effect.Effect<PresenceRoom> =>
    Effect.suspend(() => {
      if (cachedRoom !== undefined) return Effect.succeed(cachedRoom)
      if (!hasPresence) {
        return Effect.die('Presence RPC received but no presence schemas are configured')
      }
      return Effect.map(
        makePresenceRoom('__party__', {
          ...doOptions!.presence!.room,
          channels: Object.fromEntries(
            Object.entries(schemas!).map(([name, schema]) => [name, { schema }]),
          ),
        }),
        (room) => {
          cachedRoom = room
          return room
        },
      )
    })

  const handlersLayer = SyncWsRpc.toLayer({
    'SyncWsRpc.Pull': (req) =>
      Effect.gen(function* () {
        const headers = yield* getForwardedHeaders
        return makeEndingPullStream({ req, payload: req.payload, headers }).pipe(
          // Needed to keep the stream alive on the client side for phase 2 (i.e. not send the `Exit` stream RPC message)
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
        const { doOptions, storeId, ctx, env } = yield* DoCtx.DoCtx
        const headers = yield* getForwardedHeaders

        const push = makePush({ options: doOptions, storeId, payload: req.payload, headers, ctx, env })

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
    'SyncWsRpc.PresenceJoin': ({ storeId, channel, clientId, name }) =>
      Effect.gen(function* () {
        const room = yield* getRoom()
        yield* room.join(channel, clientId, name).pipe(Effect.ignore)
      }),
    'SyncWsRpc.PresenceUpdate': ({ storeId, channel, clientId, patch }) =>
      Effect.gen(function* () {
        const room = yield* getRoom()
        yield* room.update(channel, clientId, patch).pipe(Effect.ignore)
      }),
    'SyncWsRpc.PresenceLeave': ({ storeId, channel, clientId }) =>
      Effect.gen(function* () {
        const room = yield* getRoom()
        yield* room.leave(channel, clientId).pipe(Effect.ignore).pipe(Effect.tapCauseLogPretty)
      }),
    'SyncWsRpc.PresenceSnapshots': ({ storeId, channel }) =>
      Effect.gen(function* () {
        const room = yield* getRoom()
        return room.snapshots(channel)
      }).pipe(Stream.unwrap),
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