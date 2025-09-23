/// <reference types="@cloudflare/workers-types" />

import '@livestore/adapter-cloudflare/polyfill'

import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import { storeIdFromRequest, type Env } from './env.ts'

const handler = {
  fetch: async (request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) => {
    const url = new URL(request.url)

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

    if (url.pathname.includes('/client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.CLIENT_DO.idFromName(storeId)

      return env.CLIENT_DO.get(id).fetch(request)
    }

    if (url.pathname === '/') {
      // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
      return new Response('LiveChat App with CF DO Bot') as CfTypes.Response
    }

    // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
    return new Response('Not found', { status: 404 }) as CfTypes.Response
  },
}

export default handler satisfies CfTypes.ExportedHandler<Env>
