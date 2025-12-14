import { makeHttpSync } from '@livestore/sync-http/client'

const _backend = makeHttpSync({
  url: 'http://localhost:3000', // Your sync server URL
  // Optional: Custom headers for authentication
  headers: {
    Authorization: 'Bearer <token>',
  },
  // Optional: Configure live pull polling
  livePull: {
    pollInterval: 5000, // Poll every 5 seconds (default)
  },
})
