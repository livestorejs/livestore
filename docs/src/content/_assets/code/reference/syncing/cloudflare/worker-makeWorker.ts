import { makeWorker } from '@livestore/sync-cf/cf-worker'

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  validatePayload: (payload, { storeId }) => {
    // Simple token-based guard at connection time
    const authToken = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'authToken') : undefined
    if (typeof authToken !== 'string') {
      throw new Error('Missing auth token')
    }
    if (authToken !== 'insecure-token-change-me') {
      throw new Error('Invalid auth token')
    }
    console.log(`Validated connection for store: ${storeId}`)
  },
  enableCORS: true,
})
