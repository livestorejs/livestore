import path from 'node:path'
import { makeHttpSync } from '@livestore/sync-cf'
import { Effect, Layer } from '@livestore/utils/effect'
import { startWranglerDevServer } from '@livestore/utils-dev/node-vitest'
import { SyncProviderImpl } from '../types.ts'

export const name = 'Cloudflare HTTP RPC'

export const layer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const { port } = yield* startWranglerDevServer({ cwd: path.join(import.meta.dirname, 'cloudflare') })

    return {
      makeProvider: makeHttpSync({ baseUrl: `http://localhost:${port}` }),
    }
  }),
)
