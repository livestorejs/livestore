/// <reference path="./types.d.ts" />

import type { ClientDoWithRpcCallback } from '@livestore/adapter-cloudflare'
import type { CfTypes, SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'

export type Env = {
  CLIENT_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  DB: CfTypes.D1Database
  ADMIN_SECRET: string
}
