import type { CfTypes, SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'

export interface Env {
  ADMIN_SECRET: string // Admin authentication
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
}
