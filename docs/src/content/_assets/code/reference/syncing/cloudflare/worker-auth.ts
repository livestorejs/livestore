import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message, { storeId }) => {
    // Log all sync events
    console.log(`Store ${storeId} received ${message.batch.length} events`)
  },
}) {}

const hasStoreAccess = (_userId: string, _storeId: string): boolean => true

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  validatePayload: (payload, { storeId }) => {
    if (!(typeof payload === 'object' && payload !== null && 'userId' in payload)) {
      throw new Error('User ID required')
    }

    // Validate user has access to store
    if (!hasStoreAccess((payload as any).userId as string, storeId)) {
      throw new Error('Unauthorized access to store')
    }
  },
  enableCORS: true,
})
