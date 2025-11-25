import { makeSyncBackend } from '@livestore/sync-electric'

const _backend = makeSyncBackend({
  endpoint: '/api/electric', // Your API proxy endpoint
  ping: { enabled: true },
})
