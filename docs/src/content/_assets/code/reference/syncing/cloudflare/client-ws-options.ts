import { makeWsSync } from '@livestore/sync-cf/client'

export const syncBackend = makeWsSync({
  url: 'wss://sync.example.com',
  ping: {
    enabled: true,
    requestTimeout: 5000,
    requestInterval: 15000,
  },
})
