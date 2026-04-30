import { makeHttpSync } from '@livestore/sync-cf/client'

export const syncBackend = makeHttpSync({
  url: 'https://sync.example.com',
  headers: {
    Authorization: 'Bearer token',
    'X-Custom-Header': 'value',
  },
  livePull: {
    pollInterval: 2000, // Poll every 2 seconds
  },
})
