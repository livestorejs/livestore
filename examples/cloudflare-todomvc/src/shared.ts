import type { CfTypes, SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'

import type { LiveStoreClientDO } from './live-store-client-do.ts'

export type Env = {
  CLIENT_DO: CfTypes.DurableObjectNamespace<LiveStoreClientDO>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
}

export const storeIdFromRequest = (request: CfTypes.Request) => {
  const url = new URL(request.url)
  const storeId = url.searchParams.get('storeId')

  if (storeId === null) {
    throw new Error('storeId is required in URL search params')
  }

  return storeId
}
