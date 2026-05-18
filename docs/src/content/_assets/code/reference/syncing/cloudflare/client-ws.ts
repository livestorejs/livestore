import { makeWsSync } from '@livestore/sync-cf/client'

export const syncBackend = makeWsSync({
  url: 'wss://sync.example.com',
})
