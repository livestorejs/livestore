import type { EventSequenceNumber } from '@livestore/common/schema'
import {
  Effect,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  Layer,
  Option,
  Queue,
  RpcSerialization,
  RpcServer,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import {
  type CallbackContext,
  type HttpLivePullMode,
  type ServerCallbacks,
  SyncHttpRpc,
  SyncMessage,
} from '../../common/mod.ts'
import type { SyncStorage } from '../storage/mod.ts'
import { makePullStream, type PullHandlerDeps } from './pull.ts'
import { handlePush, type PushHandlerDeps } from './push.ts'

export type HttpHandlerConfig = {
  readonly storage: SyncStorage
  readonly callbacks?: ServerCallbacks | undefined
  readonly responseHeaders?: Record<string, string> | undefined
  readonly livePull?: HttpLivePullMode | undefined
  readonly pollInterval?: number | undefined
}

/** Active SSE connections per storeId */
type LiveConnection = {
  readonly queue: Queue.Queue<SyncMessage.PullResponse>
  readonly clientId: string
}

/**
 * Creates the HTTP RPC handler layer for the sync server.
 * Supports both request/response and SSE streaming for live pulls.
 */
export const makeHttpRpcLayer = (config: HttpHandlerConfig) => {
  /** Map of storeId -> Set of live connections */
  const liveConnections = new Map<string, Set<LiveConnection>>()

  const addLiveConnection = (storeId: string, conn: LiveConnection) => {
    const connections = liveConnections.get(storeId) ?? new Set()
    connections.add(conn)
    liveConnections.set(storeId, connections)
  }

  const removeLiveConnection = (storeId: string, conn: LiveConnection) => {
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

  /** Create a callback context for the handlers */
  const makeContext = (storeId: string, clientId: string): CallbackContext => ({
    storeId,
    clientId,
    // Note: Header forwarding is not yet supported in the RPC handlers
    // Headers can be accessed via SSE endpoints which receive the request directly
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

  return SyncHttpRpc.toLayer({
    'SyncHttpRpc.Pull': (req) =>
      Effect.gen(function* () {
        const context = makeContext(req.storeId, 'http-client')

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
        const conn: LiveConnection = { queue, clientId: context.clientId }

        addLiveConnection(req.storeId, conn)

        // Combine initial events with live updates
        const liveStream = Stream.fromQueue(queue)

        return Stream.concat(initialStream, liveStream).pipe(
          Stream.ensuring(Effect.sync(() => removeLiveConnection(req.storeId, conn))),
        )
      }).pipe(Stream.unwrap),

    'SyncHttpRpc.Push': (req) =>
      Effect.gen(function* () {
        const context = makeContext(req.storeId, 'http-client')

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

    'SyncHttpRpc.Ping': () => Effect.succeed(SyncMessage.Pong.make({})),
  }).pipe(
    Layer.provideMerge(RpcServer.layerProtocolHttp({ path: '/rpc' })),
    Layer.provideMerge(RpcSerialization.layerJson),
  )
}

/**
 * Creates an SSE endpoint for live pull updates.
 * This is an alternative to using the RPC streaming endpoint.
 */
export const makeSseRouter = (config: HttpHandlerConfig) => {
  const encodeResponse = Schema.encodeSync(Schema.parseJson(SyncMessage.PullResponse))

  return HttpRouter.empty.pipe(
    HttpRouter.get(
      '/sse/:storeId',
      Effect.gen(function* () {
        const httpReq = yield* HttpServerRequest.HttpServerRequest
        const params = yield* HttpRouter.params
        const storeId = params.storeId

        if (!storeId) {
          return HttpServerResponse.text('Missing storeId', { status: 400 })
        }

        // Parse cursor from query string
        const url = new URL(httpReq.url, 'http://localhost')
        const cursorParam = url.searchParams.get('cursor')
        const cursor = cursorParam
          ? Option.some({
              backendId: url.searchParams.get('backendId') ?? '',
              eventSequenceNumber: Number.parseInt(cursorParam, 10) as EventSequenceNumber.Global.Type,
            })
          : Option.none()

        const context: CallbackContext = {
          storeId,
          clientId: 'sse-client',
          headers: undefined, // TODO: extract headers
        }

        const pullReq: SyncMessage.PullRequest = { cursor, live: true }

        // Create queue for live updates
        const queue = yield* Queue.unbounded<SyncMessage.PullResponse>()
        const _conn: LiveConnection = { queue, clientId: context.clientId }

        // Get initial events
        const initialStream = makePullStream({
          req: pullReq,
          storeId,
          context,
          deps: { storage: config.storage, callbacks: config.callbacks },
        })

        // Combine with live updates
        const liveStream = Stream.fromQueue(queue)
        const combinedStream = Stream.concat(initialStream, liveStream)

        // Format as SSE
        const sseStream = combinedStream.pipe(
          Stream.map((response) => {
            const data = encodeResponse(response)
            return `event: message\ndata: ${data}\n\n`
          }),
          Stream.ensuring(
            Effect.sync(() => {
              // Cleanup would happen here
            }),
          ),
          Stream.encodeText,
        )

        return HttpServerResponse.stream(sseStream, {
          contentType: 'text/event-stream',
          headers: {
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...(config.responseHeaders ?? {}),
          },
        })
      }),
    ),
  )
}
