import { makeWorker } from '@livestore/sync-cf/cf-worker'

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  validatePayload: (payload, { storeId }) => {
    // Simple token-based guard at connection time
    const hasAuthToken = typeof payload === 'object' && payload !== null && 'authToken' in payload
    if (!hasAuthToken) {
      throw new Error('Missing auth token')
    }
    if ((payload as any).authToken !== 'insecure-token-change-me') {
      throw new Error('Invalid auth token')
    }
    console.log(`Validated connection for store: ${storeId}`)
  },
  enableCORS: true,
})
