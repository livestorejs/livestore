import type { CfTypes, SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'
import { makeDoRpcSync } from '@livestore/sync-cf/client'

declare const state: CfTypes.DurableObjectState
declare const syncBackendDurableObject: CfTypes.DurableObjectStub<SyncBackendRpcInterface>

export const syncBackend = makeDoRpcSync({
  syncBackendStub: syncBackendDurableObject,
  durableObjectContext: {
    bindingName: 'CLIENT_DO',
    durableObjectId: state.id.toString(),
  },
})
