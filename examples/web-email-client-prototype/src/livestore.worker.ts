import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'
import { schema } from './livestore/schema.ts'

makeWorker({
  schema,
  // For now, let's disable sync until we figure out the correct CF sync approach
  sync: {
    backend: makeWsSync({ url: import.meta.env.VITE_LIVESTORE_SYNC_URL }),
  },
})
