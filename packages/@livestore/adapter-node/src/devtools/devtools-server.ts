import http from 'node:http'
import path from 'node:path'

import type { Devtools } from '@livestore/common'
import { LS_DEV } from '@livestore/utils'
import type { HttpClient } from '@livestore/utils/effect'
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
  clientSessionInfo,
  port,
  host,
}: {
  schemaPath: string
  clientSessionInfo: Devtools.SessionInfo.SessionInfo | undefined
  host: string
  port: number
}): Effect.Effect<never, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const viteMiddleware = yield* makeViteMiddleware({
      mode: { _tag: 'node', url: `http://${host}:${port}` },
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
        // yield* Effect.logDebug(`WS Relay ${relayNodeName}: WS upgrade request ${req.url}`)

        const socket = yield* req.upgrade

        const { webChannel, from } = yield* makeWebSocketEdge({ socket, socketType: { _tag: 'relay' } })

        // To handle websocket closing, we need to race the `webChannel.closedDeferred` to properly interrupt the handler
        yield* Effect.raceFirst(
          Effect.gen(function* () {
            yield* node
              .addEdge({ target: from, edgeChannel: webChannel, replaceIfExists: true })
              .pipe(Effect.acquireRelease(() => node.removeEdge(from).pipe(Effect.orDie)))

            if (LS_DEV) {
              yield* Effect.log(`WS Relay ${relayNodeName}: added edge from '${from}'`)
              yield* Effect.addFinalizerLog(`WS Relay ${relayNodeName}: removed edge from '${from}'`)
            }

            // We want to keep the websocket open until the client disconnects or the server shuts down
            yield* Effect.never
          }),
          webChannel.closedDeferred,
        )

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
    }).pipe(Effect.tapCauseLogPretty, Effect.interruptible)

    const sessionSuffix = clientSessionInfo
      ? `/${clientSessionInfo.storeId}/${clientSessionInfo.clientId}/${clientSessionInfo.sessionId}/${clientSessionInfo.schemaAlias}`
      : '?autoconnect'

    yield* Effect.logDebug(
      `[@livestore/devtools] LiveStore devtools are available at http://${host}:${port}/_livestore/node${sessionSuffix}`,
    )

    return HttpServer.serve(handler, HttpMiddleware.logger)
  }).pipe(
    Effect.withSpan('@livestore/adapter-node:startDevtoolsServer', {
      attributes: { clientSessionInfo, port, host, schemaPath },
    }),
    HttpMiddleware.withLoggerDisabled,
    Layer.unwrapScoped,
    Layer.provide(PlatformNode.NodeHttpServer.layer(() => http.createServer(), { port, host })),
    Layer.launch,
    Effect.orDie,
  )
