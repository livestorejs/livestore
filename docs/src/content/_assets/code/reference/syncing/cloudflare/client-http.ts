import { makeHttpSync } from '@livestore/sync-cf/client'

export const syncBackend = makeHttpSync({
  url: 'https://sync.example.com',
  livePull: {
    pollInterval: 3000, // Poll every 3 seconds
  },
})
