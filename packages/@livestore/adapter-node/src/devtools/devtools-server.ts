import http from 'node:http'
import path from 'node:path'

import { LS_DEV } from '@livestore/utils'
import {
  Deferred,
  Effect,
  Exit,
  Headers,
  HttpMiddleware,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Layer,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { makeMeshNode, makeWebSocketEdge } from '@livestore/webmesh'

import { makeViteMiddleware } from './vite-dev-server.js'

/**
 * Starts a devtools HTTP/WS server which serves ...
 * - the Devtools UI via Vite
 * - the Devtools Protocol via WebSocket Webmesh
 */
export const startDevtoolsServer = ({
  schemaPath,
  schemaAlias,
  storeId,
  clientId,
  sessionId,
  port,
  host,
}: {
  schemaPath: string
  schemaAlias: string
  storeId: string
  clientId: string
  sessionId: string
  host: string
  port: number
}) =>
  Effect.gen(function* () {
    const clientSessionInfo = { storeId, clientId, sessionId }
    const viteMiddleware = yield* makeViteMiddleware({
      mode: { _tag: 'node', clientSessionInfo, url: `ws://localhost:${port}` },
      schemaPath: path.resolve(process.cwd(), schemaPath),
      viteConfig: (viteConfig) => {
        if (LS_DEV) {
          viteConfig.server ??= {}
          viteConfig.server.fs ??= {}
          viteConfig.server.fs.strict = false

          viteConfig.optimizeDeps ??= {}
          viteConfig.optimizeDeps.force = true
        }

        return viteConfig
      },
    }).pipe(Effect.acquireRelease((viteMiddleware) => Effect.promise(() => viteMiddleware.close())))

    const relayNodeName = 'ws'

    const node = yield* makeMeshNode(relayNodeName)

    const handler = Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest

      if (Headers.has(req.headers, 'upgrade')) {
        // yield* Effect.log(`WS Relay ${relayNodeName}: request ${req.url}`)

        const socket = yield* req.upgrade

        const { webChannel, from } = yield* makeWebSocketEdge({ socket, socketType: { _tag: 'relay' } })

        yield* node
          .addEdge({ target: from, edgeChannel: webChannel, replaceIfExists: true })
          .pipe(Effect.acquireRelease(() => node.removeEdge(from).pipe(Effect.orDie)))

        if (LS_DEV) {
          yield* Effect.log(`WS Relay ${relayNodeName}: added edge from '${from}'`)
          yield* Effect.addFinalizerLog(`WS Relay ${relayNodeName}: removed edge from '${from}'`)
        }

        // We want to keep the websocket open until the client disconnects or the server shuts down
        yield* Effect.never

        return HttpServerResponse.empty({ status: 101 })
      } else {
        if (req.url === '/' || req.url === '') {
          return HttpServerResponse.redirect('/_livestore/node')
        } else if (req.url.startsWith('/_livestore')) {
          // Here we're delegating to the Vite middleware

          // TODO replace this once @effect/platform-node supports Node HTTP middlewares
          const nodeReq = PlatformNode.NodeHttpServerRequest.toIncomingMessage(req)
          const nodeRes = PlatformNode.NodeHttpServerRequest.toServerResponse(req)
          const deferred = yield* Deferred.make()
          viteMiddleware.middlewares(nodeReq, nodeRes, () => Deferred.unsafeDone(deferred, Exit.void))
          yield* deferred

          // The response is already sent, so we need to return an empty response (which won't be sent)
          return HttpServerResponse.empty()
        }
      }

      return HttpServerResponse.text('Not found')
    }).pipe(Effect.interruptible)

    yield* Effect.logDebug(
      `[@livestore/adapter-node:devtools] LiveStore devtools are available at http://${host}:${port}/_livestore/node/${storeId}/${clientId}/${sessionId}/${schemaAlias}`,
    )

    return HttpServer.serve(handler, HttpMiddleware.logger)
  }).pipe(
    Effect.withSpan('@livestore/adapter-node:startDevtoolsServer', {
      attributes: { storeId, clientId, sessionId, port, host, schemaPath },
    }),
    Layer.unwrapScoped,
    // HttpServer.withLogAddress,
    Layer.provide(PlatformNode.NodeHttpServer.layer(() => http.createServer(), { port, host })),
    Layer.launch,
    Effect.orDie,
  )
