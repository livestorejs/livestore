import { createSyncServer } from '@livestore/sync-http/server'

const server = await createSyncServer({
  port: 3000,
  storage: { type: 'memory' },
})

console.log(`Sync server running at ${server.url}`)

// Later, to stop the server:
// await server.stop()
