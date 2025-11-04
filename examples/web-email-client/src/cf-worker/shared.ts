import type { ClientDoWithRpcCallback } from '@livestore/adapter-cloudflare'
import type * as SyncBackend from '@livestore/sync-cf/cf-worker'

export type Env = {
  INBOX_CLIENT_DO: SyncBackend.CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  THREAD_CLIENT_DO: SyncBackend.CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  SYNC_BACKEND_DO: SyncBackend.CfTypes.DurableObjectNamespace<SyncBackend.SyncBackendRpcInterface>
  SYNC_BACKEND_URL: string
  DB: D1Database
  ADMIN_SECRET: string
}

export const storeIdFromRequest = (request: SyncBackend.CfTypes.Request) => {
  const url = new URL(request.url)
  const storeId = url.searchParams.get('storeId')

  if (storeId === null) {
    throw new Error('storeId is required in URL search params')
  }

  return storeId
}
