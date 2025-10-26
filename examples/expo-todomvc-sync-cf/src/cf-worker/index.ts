import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'
import { SyncPayload } from '../livestore/schema.ts'

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message, context) => {
    console.log('onPush', message.batch, 'storeId:', context.storeId, 'payload:', context.payload)
  },
  onPull: async (message, context) => {
    console.log('onPull', message, 'storeId:', context.storeId, 'payload:', context.payload)
  },
}) {}

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  syncPayloadSchema: SyncPayload,
  validatePayload: (payload, context) => {
    console.log(`Validating connection for store: ${context.storeId}`)
    if (payload?.authToken !== 'insecure-token-change-me') {
      throw new Error('Invalid auth token')
    }
  },
  enableCORS: true,
})
