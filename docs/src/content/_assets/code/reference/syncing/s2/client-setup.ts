import { makeSyncBackend } from '@livestore/sync-s2'

const backend = makeSyncBackend({
  endpoint: '/api/s2', // Your API proxy endpoint
  // more options...
})
