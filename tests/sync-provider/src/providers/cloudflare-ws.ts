import path from 'node:path'
import { UnexpectedError } from '@livestore/common'
import { makeWsSync } from '@livestore/sync-cf/client'
import { Effect, Layer } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/wrangler'
import { SyncProviderImpl, type SyncProviderLayer } from '../types.ts'

export const name = 'Cloudflare WebSocket'

export const prepare = Effect.void

const makeLayer = (config?: { wranglerConfigPath?: string; label: string }): SyncProviderLayer =>
  Layer.scoped(
    SyncProviderImpl,
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService

      return {
        makeProvider: makeWsSync({ url: server.url }),
        turnBackendOffline: Effect.log('TODO implement turnBackendOffline'),
        turnBackendOnline: Effect.log('TODO implement turnBackendOnline'),
        providerSpecific: {},
      }
    }),
  ).pipe(
    Layer.provide(
      WranglerDevServerService.Default({
        cwd: path.join(import.meta.dirname, 'cloudflare'),
        wranglerConfigPath: config?.wranglerConfigPath,
      }).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
    ),
    UnexpectedError.mapToUnexpectedErrorLayer,
  )

export const d1 = {
  name: `${name} (D1)`,
  layer: makeLayer({
    label: 'D1',
    wranglerConfigPath: path.join(import.meta.dirname, 'cloudflare', 'wrangler-d1.toml'),
  }),
  prepare,
}
export const doSqlite = {
  name: `${name} (DO)`,
  layer: makeLayer({
    wranglerConfigPath: path.join(import.meta.dirname, 'cloudflare', 'wrangler-do-sqlite.toml'),
    label: 'DO',
  }),
  prepare,
}
