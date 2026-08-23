import { UnknownError } from '@livestore/common'
import { WsContext } from '@livestore/common-cf'
import { Effect, identity, Layer, Result, RpcServer, Schema, Stream } from '@livestore/utils/effect'

import { SyncWsRpc } from '../../../common/ws-rpc-schema.ts'
import {
  headersRecordToMap,
  type MakeDurableObjectClassOptions,
  WebSocketAttachmentSchema,
} from '../../shared.ts'
import { makePresenceRoom, type PresenceRoom, type PresenceRoomOptions } from '../../../presence/room.ts'
import * as DoCtx from '../layer.ts'
import { makeEndingPullStream } from '../pull.ts'
import { makePush } from '../push.ts'

export const makeRpcServer = ({ doSelf, doOptions }: Omit<DoCtx.DoCtxInput, 'from'>) => {
  /**
   * Ephemeral presence rooms hosted by this party — one per storeId the DO
   * serves. Single-party model: the same DO that arbitrates the durable
   * eventlog also fans out presence. Never persisted; pruned by idle TTL.
   */
  const rooms = new Map<string, PresenceRoom>()
  const roomOptions: PresenceRoomOptions | undefined = doOptions?.presence?.room

  const getRoom = Effect.fnUntraced(function* (storeId: string) {
    const existing = rooms.get(storeId)
    if (existing !== undefined) return existing
    const room = yield* makePresenceRoom(storeId, roomOptions)
    rooms.set(storeId, room)
    return room
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
    'SyncWsRpc.PresenceJoin': ({ storeId, clientId, name }) =>
      Effect.gen(function* () {
        const room = yield* getRoom(storeId)
        yield* room.join(clientId, name)
      }),
    'SyncWsRpc.PresenceUpdate': ({ storeId, state }) =>
      Effect.gen(function* () {
        const room = yield* getRoom(storeId)
        yield* room.update(state)
      }),
    'SyncWsRpc.PresenceLeave': ({ storeId, clientId }) =>
      Effect.gen(function* () {
        const room = yield* getRoom(storeId)
        yield* room.leave(clientId)
      }),
    'SyncWsRpc.PresenceSnapshots': ({ storeId }) =>
      Effect.gen(function* () {
        const room = yield* getRoom(storeId)
        return room.snapshots
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