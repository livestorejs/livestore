import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'

import type { Env } from './shared.ts'
import { storeIdFromRequest } from './shared.ts'

export default {
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url)

    const searchParams = SyncBackend.matchSyncRequest(request)

    if (searchParams !== undefined) {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
        headers: {},
      })
    }

    if (url.pathname.endsWith('/client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.CLIENT_DO.idFromName(storeId)

      return env.CLIENT_DO.get(id).fetch(request)
    }

    if (url.pathname === '/') {
      return new Response('CloudFlare TodoMVC LiveStore Demo')
    }

    return new Response('Invalid path', { status: 400 })
  },
} satisfies CfTypes.ExportedHandler<Env>
