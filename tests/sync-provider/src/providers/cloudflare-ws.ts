import path from 'node:path'
import { makeCfSync } from '@livestore/sync-cf/client'
import { Effect, Layer } from '@livestore/utils/effect'
import { startWranglerDevServer } from '@livestore/utils-dev/node-vitest'
import { SyncProviderImpl } from '../types.ts'

export const name = 'Cloudflare WebSocket'

export const layer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const { port } = yield* startWranglerDevServer({ cwd: path.join(import.meta.dirname, 'cloudflare') })

    return {
      makeProvider: makeCfSync({ url: `http://localhost:${port}` }),
    }
  }),
)
