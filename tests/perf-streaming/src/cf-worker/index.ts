import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { SyncPayload } from '../../test-app/src/livestore/schema.ts'
import { SYNC_AUTH_TOKEN } from '../shared/constants.ts'

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  onPush: async (_message, _context) => {
    // Intentionally left blank; perf harness only needs confirmation semantics.
  },
  onPull: async (_message, _context) => {
    // Intentionally left blank; perf harness only needs confirmation semantics.
  },
}) {}

const validatePayload = (payload: typeof SyncPayload.Type | undefined, context: { storeId: string }) => {
  if (payload?.authToken !== SYNC_AUTH_TOKEN) {
    throw new Error(`Invalid auth token for store ${context.storeId}`)
  }
}

export default {
  async fetch(request: CfTypes.Request, _env: SyncBackend.Env, ctx: CfTypes.ExecutionContext) {
    const searchParams = SyncBackend.matchSyncRequest(request)
    if (searchParams !== undefined) {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
        syncPayloadSchema: SyncPayload,
        validatePayload,
      })
    }

    return new Response('Not Found', { status: 404 })
  },
}
