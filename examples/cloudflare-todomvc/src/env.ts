import type { ClientDoWithRpcCallback } from '@livestore/adapter-cloudflare'
import type { D1Database } from '@cloudflare/workers-types'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import type { SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'

export type Env = {
  CLIENT_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  DB: D1Database
  ADMIN_SECRET: string
}

export const storeIdFromRequest = (request: CfTypes.Request) => {
  const url = new URL(request.url)
  const storeId = url.searchParams.get('storeId')

  if (storeId === null) {
    throw new Error('storeId is required in URL search params')
  }

  return storeId
}
