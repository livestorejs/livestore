import type { CfTypes, SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'

export interface Env {
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
}
