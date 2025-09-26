import type { CfTypes, CFWorker } from '@livestore/sync-cf/cf-worker'
import { handleSyncRequest, matchSyncRequest } from '@livestore/sync-cf/cf-worker'
import type { Env } from './env.ts'

export default {
  fetch: async (request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) => {
    const searchParams = matchSyncRequest(request)

    if (searchParams !== undefined) {
      return handleSyncRequest({
        request,
        searchParams,
        env,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
      })
    }

    // Custom routes, assets, etc.
    return new Response('Not found', { status: 404 }) as unknown as CfTypes.Response
  },
} satisfies CFWorker<Env>
