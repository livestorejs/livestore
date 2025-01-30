import http from 'node:http'
import path from 'node:path'

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
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const httpServer = http.createServer()
    const webSocketServer = yield* makeWebSocketServer({ relayNodeName: 'ws' })

    yield* Effect.addFinalizer(() => Effect.sync(() => httpServer.close()))

    // Handle upgrade manually
    httpServer.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket, head, (ws) => {
        webSocketServer.emit('connection', ws, request)
      })
    })

    httpServer.listen(port, () => {
      console.log(`LiveStore devtools are available at http://localhost:${port}/livestore-devtools`)
    })

    const viteServer = yield* Effect.promise(() =>
      makeViteServer({
        mode: { _tag: 'node', storeId, clientId, sessionId, url: `ws://localhost:${port}` },
        schemaPath: path.resolve(process.cwd(), schemaPath),
        viteConfig: (viteConfig) => {
          viteConfig.server ??= {}
          viteConfig.server.fs ??= {}

          // TODO move this into the example code
          // Point to Overtone monorepo root
          viteConfig.server.fs.allow ??= []
          viteConfig.server.fs.allow.push(process.env.WORKSPACE_ROOT + '/../..')

          viteConfig.optimizeDeps ??= {}
          viteConfig.optimizeDeps.force = true

          return viteConfig
        },
      }),
    )

    yield* Effect.addFinalizer(() => Effect.promise(() => viteServer.close()))

    httpServer.on('request', (req, res) => {
      if (req.url === '/' || req.url === '') {
        res.writeHead(302, { Location: '/livestore-devtools' })
        res.end()
      } else if (req.url?.startsWith('/livestore-devtools')) {
        return viteServer.middlewares(req, res as any)
      }
    })
  }).pipe(Effect.withSpan('@livestore/node:devtools:startDevtoolsServer'))
