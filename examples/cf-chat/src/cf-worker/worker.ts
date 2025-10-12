/// <reference types="@cloudflare/workers-types" />

import '@livestore/adapter-cloudflare/polyfill'

import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { type Env, storeIdFromRequest } from './shared.ts'

export default {
  fetch: async (request, env, ctx) => {
    // Handle LiveStore sync requests
    const searchParams = SyncBackend.matchSyncRequest(request)
    if (searchParams !== undefined) {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams,
        env,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
      })
    }

    const url = new URL(request.url)

    if (url.pathname.includes('/client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.CLIENT_DO.idFromName(storeId)

      return env.CLIENT_DO.get(id).fetch(request)
    }

    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) {
      return assetResponse as CfTypes.Response
    }

    // @ts-expect-error TODO remove casts once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
    return new Response('Not found', { status: 404 }) as CfTypes.Response
  },
} satisfies CfTypes.ExportedHandler<Env>
