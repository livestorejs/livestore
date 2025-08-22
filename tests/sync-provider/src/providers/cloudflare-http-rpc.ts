import path from 'node:path'
import { makeHttpSync } from '@livestore/sync-cf/client'
import { Effect, Layer } from '@livestore/utils/effect'
import { startWranglerDevServer } from '@livestore/utils-dev/node-vitest'
import { SyncProviderImpl } from '../types.ts'

export const name = 'Cloudflare HTTP RPC'

export const layer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const { port } = yield* startWranglerDevServer({ cwd: path.join(import.meta.dirname, 'cloudflare') })

    return {
      makeProvider: makeHttpSync({
        url: `http://localhost:${port}`,
        livePull: {
          // For testing purposes, we're polling every 200ms (brr, brr, brr, ...)
          pollInterval: 200,
        },
      }),
      turnBackendOffline: Effect.log('TODO implement turnBackendOffline'),
      turnBackendOnline: Effect.log('TODO implement turnBackendOnline'),
      push: () => Effect.log('TODO implement push'),
    }
  }),
)
