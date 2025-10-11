import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'

import { schema } from '@/lib/livestore/schema'

const defaultSyncUrl =
  typeof globalThis.location !== 'undefined'
    ? `${globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${globalThis.location.host}`
    : 'ws://localhost:8787'

const envSyncUrl = import.meta.env.VITE_LIVESTORE_SYNC_URL
const syncUrl = envSyncUrl && envSyncUrl.length > 0 ? envSyncUrl : defaultSyncUrl

makeWorker({
  schema,
  sync: {
    backend: makeWsSync({ url: syncUrl }),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
})
