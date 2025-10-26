import { makeDurableObject } from '@livestore/sync-cf/cf-worker'

const hasUserId = (p: unknown): p is { userId: string } =>
  typeof p === 'object' && p !== undefined && p !== null && 'userId' in p

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message, { storeId, payload }) => {
    console.log(`Push to store ${storeId}:`, message.batch)

    // Custom business logic
    if (hasUserId(payload)) {
      await Promise.resolve()
    }
  },
  onPull: async (_message, { storeId }) => {
    console.log(`Pull from store ${storeId}`)
  },
  enabledTransports: new Set(['ws', 'http']), // Disable DO RPC
  otel: {
    baseUrl: 'https://otel.example.com',
    serviceName: 'livestore-sync',
  },
}) {}
