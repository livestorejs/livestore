import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import type { Env } from './env.ts'
import { storeIdFromRequest } from './shared.ts'

export default {
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
        headers: {},
      })
    }

    if (url.pathname.endsWith('/client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.CLIENT_DO.idFromName(storeId)
      return env.CLIENT_DO.get(id).fetch(request)
    }

    return new Response('Not found', { status: 404 }) as unknown as CfTypes.Response
  },
} satisfies SyncBackend.CFWorker<Env>
