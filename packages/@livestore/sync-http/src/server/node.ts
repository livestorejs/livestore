import { createServer } from 'node:http'
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient'
import { HttpLayerRouter, HttpMiddleware, Layer, RpcSerialization, RpcServer } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { SyncRpcGroup } from '../shared.ts'
import { HealthRoute } from './health-route.ts'
import { SpaRoute } from './spa-route.ts'
import {
  type MemoryConfig,
  PlatformSqlite,
  type PostgresConfig,
  type SqliteConfig,
  StorageConfig,
} from './store-lookup.ts'
import { SyncHandlers } from './sync-handlers.ts'

export const startSyncProvider = (options: {
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
   * The protocol to use. Defaults to "websocket".
   */
  readonly protocol?: 'websocket' | 'http' | undefined
  /**
   * The storage configuration to use.
   */
  readonly storage: MemoryConfig | SqliteConfig | PostgresConfig
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
  const RpcRoute = RpcServer.layerHttpRouter({
    group: SyncRpcGroup,
    path: '/_sync',
    protocol: options.protocol ?? 'websocket',
    disableFatalDefects: true,
    spanPrefix: '@livestore/sync-http/server',
  }).pipe(
    Layer.provide(SyncHandlers),
    Layer.provide([
      options.protocol === 'http' ? RpcSerialization.layerNdjson : RpcSerialization.layerJson,
      Layer.succeed(StorageConfig, options.storage),
      Layer.succeed(PlatformSqlite, (databaseFilePath) =>
        Layer.orDie(
          SqliteClient.layer({
            filename: databaseFilePath,
          }),
        ),
      ),
    ]),
  )

  const Routes = Layer.mergeAll(RpcRoute, HealthRoute, options.spaConfig ? SpaRoute(options.spaConfig) : Layer.empty)

  const HttpLayer = HttpLayerRouter.serve(Routes).pipe(
    HttpMiddleware.withTracerDisabledForUrls(['/health']),
    Layer.provide(
      PlatformNode.NodeHttpServer.layer(createServer, {
        host: options.host,
        port: options.port ?? 3000,
      }),
    ),
  )

  PlatformNode.NodeRuntime.runMain(Layer.launch(HttpLayer))
}
