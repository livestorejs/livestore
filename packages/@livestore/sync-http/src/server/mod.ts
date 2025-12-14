import http from 'node:http'
import { Deferred, Effect, Fiber, FiberId, HttpApp, RpcServer } from '@livestore/utils/effect'
import { type SerializationFormat, type ServerCallbacks, SyncHttpRpc, type TransportConfig } from '../common/mod.ts'
import { makeHttpRpcLayer, makeSseRouter } from './handlers/mod.ts'
import { MemoryStorageLayer, SyncStorageTag } from './storage/mod.ts'

// Re-export handler utilities for advanced usage
export { makeHttpRpcLayer, makeSseRouter, makeWsRpcLayer, makeWsRpcServer } from './handlers/mod.ts'
export type { SyncServer, SyncServerConfig } from './server.ts'
// Re-export server types
export { makeSyncServerLayer, SyncServerConfigTag, SyncServerLive, SyncServerTag } from './server.ts'
export type { SyncStorage } from './storage/mod.ts'
// Re-export storage utilities
export { MemoryStorageLayer, SyncStorageTag } from './storage/mod.ts'
export type { SqliteDatabase, SqliteStorageConfig } from './storage/sqlite.ts'
export { SqliteDatabaseTag, SqliteStorageConfigTag, SqliteStorageLayer } from './storage/sqlite.ts'

/**
 * Storage configuration for the async API.
 */
export type StorageConfig = { readonly type: 'memory' } | { readonly type: 'sqlite'; readonly dataDir: string }

/**
 * Options for creating a sync server (async API).
 */
export type CreateSyncServerOptions = {
  readonly port: number
  readonly host?: string | undefined
  readonly storage?: StorageConfig | undefined
  readonly serialization?: SerializationFormat | undefined
  readonly transports?: TransportConfig | undefined
  readonly responseHeaders?: Record<string, string> | undefined
} & ServerCallbacks

/**
 * Handle returned by createSyncServer for managing the server lifecycle.
 */
export type SyncServerHandle = {
  /** The URL the server is listening on */
  readonly url: string
  /** The port the server is listening on */
  readonly port: number
  /** Stop the server and release resources */
  readonly stop: () => Promise<void>
}

/**
 * Creates a sync server with a simple async API.
 * This is the recommended entry point for most users.
 *
 * @example
 * ```ts
 * import { createSyncServer } from '@livestore/sync-http/server'
 *
 * const server = await createSyncServer({
 *   port: 3000,
 *   storage: { type: 'memory' },
 * })
 *
 * console.log(`Server running at ${server.url}`)
 *
 * // Later...
 * await server.stop()
 * ```
 */
export const createSyncServer = async (options: CreateSyncServerOptions): Promise<SyncServerHandle> => {
  const { port, host = '0.0.0.0', storage = { type: 'memory' }, transports, responseHeaders, ...callbacks } = options

  // Build the storage layer
  const storageLayer = storage.type === 'memory' ? MemoryStorageLayer : MemoryStorageLayer // TODO: SQLite layer

  // Create the HTTP app effect that builds the web handler
  const makeWebHandler = Effect.gen(function* () {
    const storageService = yield* SyncStorageTag

    const rpcLayer = makeHttpRpcLayer({
      storage: storageService,
      callbacks,
      responseHeaders,
      livePull: transports?.http?.livePull ?? 'sse',
    })

    // Build the RPC HTTP app and convert to web handler
    const rpcHttpApp = RpcServer.toHttpApp(SyncHttpRpc).pipe(Effect.provide(rpcLayer))
    const rpcWebHandler = yield* rpcHttpApp.pipe(Effect.map(HttpApp.toWebHandler))

    // Build SSE handler if enabled
    let sseWebHandler: ((req: Request) => Promise<Response>) | undefined
    if (transports?.http?.livePull === 'sse' || transports?.http?.livePull === undefined) {
      const sseRouter = makeSseRouter({
        storage: storageService,
        callbacks,
        responseHeaders,
      })
      sseWebHandler = HttpApp.toWebHandler(sseRouter)
    }

    // Combined handler that routes to the right handler
    const handler = async (request: Request): Promise<Response> => {
      const url = new URL(request.url)

      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // RPC endpoint
      if (url.pathname.startsWith('/rpc')) {
        return rpcWebHandler(request)
      }

      // SSE endpoint
      if (sseWebHandler && url.pathname.startsWith('/sse')) {
        return sseWebHandler(request)
      }

      return new Response('Not Found', { status: 404 })
    }

    return handler
  })

  // Create HTTP server
  const httpServer = http.createServer()

  // Run the effect to get the handler
  // Use Deferred to pass the handler back since we need to keep the scope alive
  const handlerDeferred = Deferred.unsafeMake<(request: Request) => Promise<Response>>(FiberId.none)
  const runtimeFiber = Effect.runFork(
    Effect.gen(function* () {
      const handler = yield* makeWebHandler.pipe(Effect.provide(storageLayer))
      Deferred.unsafeDone(handlerDeferred, Effect.succeed(handler))
      // Keep the fiber alive indefinitely to maintain the RPC server scope
      return yield* Effect.never
    }).pipe(Effect.scoped),
  )
  const handler = await Effect.runPromise(Deferred.await(handlerDeferred))

  // Handle requests
  httpServer.on('request', async (req, res) => {
    try {
      // Get actual port from the server address for correct URL construction
      const actualAddr = httpServer.address()
      const actualPort = typeof actualAddr === 'object' && actualAddr !== null ? actualAddr.port : port

      // Convert Node request to web Request
      const url = `http://${host}:${actualPort}${req.url}`
      const headers = new globalThis.Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          headers.set(key, Array.isArray(value) ? value.join(', ') : value)
        }
      }

      const body =
        req.method !== 'GET' && req.method !== 'HEAD'
          ? new ReadableStream({
              start(controller) {
                req.on('data', (chunk: Buffer) => controller.enqueue(chunk))
                req.on('end', () => controller.close())
                req.on('error', (err: Error) => controller.error(err))
              },
            })
          : undefined

      const webReq = new Request(url, {
        method: req.method,
        headers,
        body,
        // @ts-expect-error duplex is needed for streaming bodies
        duplex: body ? 'half' : undefined,
      })

      const webRes = await handler(webReq)

      // Send response
      res.statusCode = webRes.status
      for (const [key, value] of webRes.headers.entries()) {
        res.setHeader(key, value)
      }

      if (webRes.body) {
        const reader = webRes.body.getReader()
        const pump = async (): Promise<void> => {
          const { done, value } = await reader.read()
          if (done) {
            res.end()
            return
          }
          res.write(value)
          await pump()
        }
        await pump()
      } else {
        res.end()
      }
    } catch (error) {
      console.error('Request error:', error)
      res.statusCode = 500
      res.end('Internal Server Error')
    }
  })

  // Start listening
  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => resolve())
  })

  // Get the actual port (important when port: 0 is used for dynamic port allocation)
  const address = httpServer.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port

  console.log(`Sync server listening on http://${host}:${actualPort}`)

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    stop: async () => {
      // Interrupt the RPC server fiber first
      Effect.runFork(Fiber.interrupt(runtimeFiber))
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
  }
}

/**
 * Helper to create memory storage configuration.
 */
export const memoryStorage = (): StorageConfig => ({ type: 'memory' })

/**
 * Helper to create SQLite storage configuration.
 */
export const sqliteStorage = (dataDir: string): StorageConfig => ({ type: 'sqlite', dataDir })
