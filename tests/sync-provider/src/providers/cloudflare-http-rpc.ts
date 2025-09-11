import path from 'node:path'
import { UnexpectedError } from '@livestore/common'
import { makeHttpSync } from '@livestore/sync-cf/client'
import { Effect, Layer } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/wrangler'
import { SyncProviderImpl, type SyncProviderLayer } from '../types.ts'

export const name = 'Cloudflare HTTP RPC'

export const prepare = Effect.void

export const layer: SyncProviderLayer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const server = yield* WranglerDevServerService

    return {
      makeProvider: makeHttpSync({
        url: server.url,
        livePull: {
          // For testing purposes, we're polling every 200ms (brr, brr, brr, ...)
          pollInterval: 200,
        },
      }),
      turnBackendOffline: Effect.log('TODO implement turnBackendOffline'),
      turnBackendOnline: Effect.log('TODO implement turnBackendOnline'),
      providerSpecific: {},
    }
  }),
).pipe(
  Layer.provide(
    WranglerDevServerService.Default({
      cwd: path.join(import.meta.dirname, 'cloudflare'),
    }).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
  ),
  UnexpectedError.mapToUnexpectedErrorLayer,
)
