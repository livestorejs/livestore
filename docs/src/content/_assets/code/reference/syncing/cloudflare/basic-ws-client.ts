import { makeWorker } from '@livestore/adapter-web/worker'
import { makeWsSync } from '@livestore/sync-cf/client'
import { schema } from './schema.ts'

makeWorker({
  schema,
  sync: {
    backend: makeWsSync({
      url: 'wss://sync.example.com',
    }),
  },
})
