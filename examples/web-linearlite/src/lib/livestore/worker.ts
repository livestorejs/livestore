import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'
import { schema } from '@/lib/livestore/schema'

const syncUrl = import.meta.env?.VITE_LIVESTORE_SYNC_URL

makeWorker({
  schema,
  sync: syncUrl ? { backend: makeWsSync({ url: syncUrl }) } : undefined,
})
