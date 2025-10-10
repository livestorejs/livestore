import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'

import { schema } from '@/lib/livestore/schema'

const defaultSyncUrl =
  typeof globalThis.location !== 'undefined'
    ? `${globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${globalThis.location.host}`
    : 'ws://localhost:8787'

const syncUrl = import.meta.env.VITE_LIVESTORE_SYNC_URL ?? defaultSyncUrl

makeWorker({
  schema,
  sync: {
    backend: makeWsSync({ url: syncUrl }),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
})
