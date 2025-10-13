import type { ClientDoWithRpcCallback } from '@livestore/adapter-cloudflare'
import type { CfTypes, SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'

export interface AssetsBinding {
  fetch(request: CfTypes.Request): Promise<CfTypes.Response>
}

export type Env = {
  ASSETS: AssetsBinding
  CLIENT_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  SYNC_BACKEND_URL: string
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
