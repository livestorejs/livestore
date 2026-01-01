import { createServer } from 'node:http'
import { HttpLayerRouter, HttpMiddleware, Layer } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { HealthRoute } from './health-route.ts'
import { SpaRoute } from './spa-route.ts'
import { DatabaseConfig, type PostgresConfig, type SqliteConfig } from './store-lookup.ts'
import { SyncRoute } from './sync-route.ts'

export const makeHttpSyncProvider = (options: {
  /**
   * The host to run the HTTP server on. If not provided, the server will
   * listen on all interfaces.
   */
  readonly host?: string | undefined
  /**
   * The port to run the HTTP server on. If not provided, port 3000 will be
   * used.
   */
  readonly port?: number | undefined
  /**
   * The database configuration to use.
   */
  readonly databaseConfig: SqliteConfig | PostgresConfig
  /**
   * If set, the directory to serve static files from as a SPA.
   */
  readonly spaConfig?:
    | {
        readonly directory: string
        /** The index file to serve for SPA routes. Defaults to 'index.html'. */
        readonly indexFile?: string | undefined
      }
    | undefined
}): void => {
  const Routes = Layer.mergeAll(SyncRoute, HealthRoute, options.spaConfig ? SpaRoute(options.spaConfig) : Layer.empty)

  const HttpLayer = HttpLayerRouter.serve(Routes).pipe(
    HttpMiddleware.withTracerDisabledForUrls(['/health']),
    Layer.provide(
      PlatformNode.NodeHttpServer.layer(createServer, {
        host: options.host,
        port: options.port ?? 3000,
      }),
    ),
    Layer.provide(Layer.succeed(DatabaseConfig, options.databaseConfig)),
  )

  PlatformNode.NodeRuntime.runMain(Layer.launch(HttpLayer))
}
