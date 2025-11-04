/// <reference types="@cloudflare/workers-types" />

import '@livestore/adapter-cloudflare/polyfill'

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
        validatePayload: () => {
          // Custom validation logic...
        },
      })
    }

    const url = new URL(request.url)

    if (url.pathname.includes('/inbox-client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.INBOX_CLIENT_DO.idFromName(storeId)

      return env.INBOX_CLIENT_DO.get(id).fetch(request)
    }

    if (url.pathname.includes('/thread-client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.THREAD_CLIENT_DO.idFromName(storeId)

      return env.THREAD_CLIENT_DO.get(id).fetch(request)
    }

    // @ts-expect-error TODO remove casts once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
    return new Response('Not found', { status: 404 }) as SyncBackend.CfTypes.Response
  },
} satisfies SyncBackend.CfTypes.ExportedHandler<Env>
