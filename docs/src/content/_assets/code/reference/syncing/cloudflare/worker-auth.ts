import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message, { storeId }) => {
    // Log all sync events
    console.log(`Store ${storeId} received ${message.batch.length} events`)
  },
}) {}

const hasStoreAccess = (_userId: string, _storeId: string): boolean => true

const hasUserId = (payload: unknown): payload is { userId: string } =>
  typeof payload === 'object' && payload !== null && typeof Reflect.get(payload, 'userId') === 'string'

export default makeWorker({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  validatePayload: (payload, { storeId }) => {
    if (hasUserId(payload) === false) {
      throw new Error('User ID required')
    }

    // Validate user has access to store
    if (hasStoreAccess(payload.userId, storeId) === false) {
      throw new Error('Unauthorized access to store')
    }
  },
  enableCORS: true,
})
