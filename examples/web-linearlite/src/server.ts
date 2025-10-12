import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import type { CfTypes } from '@livestore/sync-cf/common'
import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  onPush: async (message, context) => {
    console.log('onPush', message.batch, 'storeId:', context.storeId, 'payload:', context.payload)
  },
  onPull: async (message, context) => {
    console.log('onPull', message, 'storeId:', context.storeId, 'payload:', context.payload)
  },
}) {}

type WorkerEnv = SyncBackend.Env & {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

const validatePayload = (payload: any, context: { storeId: string }) => {
  console.log(`Validating connection for store: ${context.storeId}`)
  if (payload?.authToken !== 'insecure-token-change-me') {
    throw new Error('Invalid auth token')
  }
}

const startFetch = createStartHandler(defaultStreamHandler)

export default {
  async fetch(request: CfTypes.Request, env: WorkerEnv, ctx: CfTypes.ExecutionContext) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const searchParams = SyncBackend.matchSyncRequest(request)

    if (searchParams !== undefined) {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams,
        env,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
        headers: corsHeaders,
        validatePayload,
      })
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const assetResponse = await env.ASSETS.fetch(request as any)
      if (assetResponse.status !== 404) {
        return assetResponse
      }
    }

    return startFetch(request as any)
  },
}
