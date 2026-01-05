import { createSyncServer } from '@livestore/sync-http/server'

const _server = await createSyncServer({
  port: 3000,
  host: '0.0.0.0', // Default: '0.0.0.0'

  // Storage backend
  storage: { type: 'memory' }, // or { type: 'sqlite', dataDir: './data' }

  // Custom headers added to all responses
  responseHeaders: {
    'Access-Control-Allow-Origin': '*',
  },

  // Lifecycle callbacks
  onPush: (req, context) => {
    console.log(`Push from store ${context.storeId}:`, req.batch.length, 'events')
  },
  onPull: (_req, context) => {
    console.log(`Pull from store ${context.storeId}`)
  },
})
