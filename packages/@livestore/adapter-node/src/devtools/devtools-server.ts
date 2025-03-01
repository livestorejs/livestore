import http from 'node:http'
import path from 'node:path'

import { UnexpectedError } from '@livestore/common'
import { LS_DEV } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect } from '@livestore/utils/effect'
import { makeWebSocketServer } from '@livestore/webmesh/websocket-server'

import { makeViteServer } from './vite-dev-server.js'

/**
 * Starts a devtools HTTP/WS server which serves ...
 * - the Devtools UI via Vite
 * - the Devtools Protocol via WebSocket Webmesh
 */
export const startDevtoolsServer = ({
  schemaPath,
  storeId,
  clientId,
  sessionId,
  port,
}: {
  schemaPath: string
  storeId: string
  clientId: string
  sessionId: string
  port: number
}): Effect.Effect<void, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const httpServer = yield* Effect.sync(() => http.createServer()).pipe(
      Effect.acquireRelease((httpServer) =>
        Effect.async<void, UnexpectedError>((cb) => {
          httpServer.removeAllListeners()
          httpServer.closeAllConnections()
          httpServer.close((err) => {
            if (err) {
              cb(Effect.fail(UnexpectedError.make({ cause: err })))
            } else {
              cb(Effect.succeed(undefined))
            }
          })
        }).pipe(Effect.orDie),
      ),
    )

    const webSocketServer = yield* makeWebSocketServer({ relayNodeName: 'ws' })

    // Handle upgrade manually
    httpServer.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket, head, (ws) => {
        webSocketServer.emit('connection', ws, request)
      })
    })

    const startServer = (port: number) =>
      Effect.async<void, UnexpectedError>((cb) => {
        httpServer.on('error', (err: any) => {
          cb(UnexpectedError.make({ cause: err }))
        })

        httpServer.listen(port, '0.0.0.0', () => {
          cb(Effect.succeed(undefined))
        })
      })

    yield* startServer(port)

    yield* Effect.logDebug(
      `[@livestore/adapter-node:devtools] LiveStore devtools are available at http://localhost:${port}/_livestore`,
    )

    const viteServer = yield* makeViteServer({
      mode: { _tag: 'node', storeId, clientId, sessionId, url: `ws://localhost:${port}` },
      schemaPath: path.resolve(process.cwd(), schemaPath),
      viteConfig: (viteConfig) => {
        if (LS_DEV) {
          viteConfig.server ??= {}
          viteConfig.server.fs ??= {}
          viteConfig.server.fs.strict = true

          viteConfig.optimizeDeps ??= {}
          viteConfig.optimizeDeps.force = true
        }

        return viteConfig
      },
    })

    yield* Effect.addFinalizer(() => Effect.promise(() => viteServer.close()))

    httpServer.on('request', (req, res) => {
      if (req.url === '/' || req.url === '') {
        res.writeHead(302, { Location: '/_livestore' })
        res.end()
      } else if (req.url?.startsWith('/_livestore')) {
        return viteServer.middlewares(req, res as any)
      }
    })
  }).pipe(Effect.withSpan('@livestore/adapter-node:devtools:startDevtoolsServer'))
