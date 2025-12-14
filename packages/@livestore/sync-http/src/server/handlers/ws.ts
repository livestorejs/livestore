import { Effect, Layer, Queue, RpcSerialization, RpcServer, Stream } from '@livestore/utils/effect'
import {
  type CallbackContext,
  type ForwardHeadersOption,
  type ServerCallbacks,
  type SyncMessage,
  SyncWsRpc,
} from '../../common/mod.ts'
import type { SyncStorage } from '../storage/mod.ts'
import { makePullStream, type PullHandlerDeps } from './pull.ts'
import { handlePush, type PushHandlerDeps } from './push.ts'

export type WsHandlerConfig = {
  readonly storage: SyncStorage
  readonly callbacks?: ServerCallbacks | undefined
  readonly forwardHeaders?: ForwardHeadersOption | undefined
}

/** Active WebSocket connections per storeId */
type WsConnection = {
  readonly queue: Queue.Queue<SyncMessage.PullResponse>
  readonly clientId: string
}

/**
 * Creates the WebSocket RPC handler layer for the sync server.
 */
export const makeWsRpcLayer = (config: WsHandlerConfig) => {
  /** Map of storeId -> Set of live connections */
  const liveConnections = new Map<string, Set<WsConnection>>()

  const addLiveConnection = (storeId: string, conn: WsConnection) => {
    const connections = liveConnections.get(storeId) ?? new Set()
    connections.add(conn)
    liveConnections.set(storeId, connections)
  }

  const removeLiveConnection = (storeId: string, conn: WsConnection) => {
    const connections = liveConnections.get(storeId)
    if (connections) {
      connections.delete(conn)
      if (connections.size === 0) {
        liveConnections.delete(storeId)
      }
    }
  }

  /** Broadcast to all live connections for a store */
  const broadcastToLive = (storeId: string, response: SyncMessage.PullResponse) =>
    Effect.gen(function* () {
      const connections = liveConnections.get(storeId)
      if (!connections || connections.size === 0) return

      for (const conn of connections) {
        yield* Queue.offer(conn.queue, response).pipe(Effect.ignore)
      }
    })

  const makeContext = (storeId: string, clientId: string): CallbackContext => ({
    storeId,
    clientId,
    headers: undefined, // WebSocket headers would need to be passed differently
  })

  const pullHandlerDeps: PullHandlerDeps = {
    storage: config.storage,
    callbacks: config.callbacks,
  }

  const pushHandlerDeps: PushHandlerDeps = {
    storage: config.storage,
    callbacks: config.callbacks,
    onBroadcast: broadcastToLive,
  }

  return SyncWsRpc.toLayer({
    'SyncWsRpc.Pull': (req) =>
      Effect.gen(function* () {
        const context = makeContext(req.storeId, 'ws-client')

        const pullReq: SyncMessage.PullRequest = {
          cursor: req.cursor,
          live: req.live,
        }

        // Get the initial pull stream
        const initialStream = makePullStream({
          req: pullReq,
          storeId: req.storeId,
          context,
          deps: pullHandlerDeps,
        })

        // If not live mode, just return the initial stream
        if (req.live !== true) {
          return initialStream
        }

        // Live mode: keep connection open and stream updates
        const queue = yield* Queue.unbounded<SyncMessage.PullResponse>()
        const conn: WsConnection = { queue, clientId: context.clientId }

        addLiveConnection(req.storeId, conn)

        // Combine initial events with live updates
        const liveStream = Stream.fromQueue(queue)

        return Stream.concat(initialStream, liveStream).pipe(
          Stream.ensuring(Effect.sync(() => removeLiveConnection(req.storeId, conn))),
        )
      }).pipe(Stream.unwrap),

    'SyncWsRpc.Push': (req) =>
      Effect.gen(function* () {
        const context = makeContext(req.storeId, 'ws-client')

        const pushReq: SyncMessage.PushRequest = {
          batch: req.batch,
          backendId: req.backendId,
        }

        return yield* handlePush({
          req: pushReq,
          storeId: req.storeId,
          context,
          deps: pushHandlerDeps,
        })
      }),
  }).pipe(Layer.provideMerge(RpcSerialization.layerJson))
}

/**
 * Returns the RpcServer layer for WebSocket connections.
 * This should be combined with a WebSocket server implementation.
 */
export const makeWsRpcServer = (config: WsHandlerConfig) =>
  RpcServer.layer(SyncWsRpc).pipe(Layer.provide(makeWsRpcLayer(config)))
