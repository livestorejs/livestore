import type { CfTypes, Env as SyncEnv } from '@livestore/sync-cf/cf-worker'
import { makeDurableObject, makeWorker, matchSyncRequest } from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message, context) => {
    console.log('onPush', message.batch, 'storeId:', context.storeId, 'payload:', context.payload)
  },
  onPull: async (message, context) => {
    console.log('onPull', message, 'storeId:', context.storeId, 'payload:', context.payload)
  },
}) {}

interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

type WorkerEnv = SyncEnv & {
  ASSETS: AssetsBinding
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<typeof SyncBackendDO>
}

const syncWorker = makeWorker<WorkerEnv>({
  syncBackendBinding: 'SYNC_BACKEND_DO',
  validatePayload: (payload: any, context) => {
    console.log(`Validating connection for store: ${context.storeId}`)
    if (payload?.authToken !== 'insecure-token-change-me') {
      throw new Error('Invalid auth token')
    }
  },
  enableCORS: true,
})

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: CfTypes.ExecutionContext) {
    if (matchSyncRequest(request) !== undefined || request.method === 'OPTIONS') {
      return syncWorker.fetch(request, env, ctx)
    }

    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) {
      return assetResponse
    }

    return new Response('Not Found', { status: 404 })
  },
}
