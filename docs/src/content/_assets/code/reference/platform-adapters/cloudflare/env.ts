import type { CfTypes, SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'

import type { LiveStoreClientDO } from './client-do.ts'

export type Env = {
  CLIENT_DO: CfTypes.DurableObjectNamespace<LiveStoreClientDO>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  DB: CfTypes.D1Database
}
