import path from 'node:path'
import { makeWsSync } from '@livestore/sync-cf/client'
import { Effect, Layer } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import { startWranglerDevServer } from '@livestore/utils-dev/node-vitest'
import { SyncProviderImpl } from '../types.ts'

export const name = 'Cloudflare WebSocket'

export const layer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const port = yield* getFreePort
    const startServer = startWranglerDevServer({ port, cwd: path.join(import.meta.dirname, 'cloudflare') })
    const { kill } = yield* startServer

    return {
      makeProvider: makeWsSync({ url: `http://localhost:${port}` }),
      turnBackendOffline: Effect.sync(() => kill()),
      turnBackendOnline: startServer.pipe(Effect.orDie),
      push: () => Effect.log('TODO implement push'),
    }
  }),
)
