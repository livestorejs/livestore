import type { CfTypes, SyncBackendRpcInterface } from '@livestore/sync-cf/cf-worker'
import { makeDoRpcSync } from '@livestore/sync-cf/client'

declare const state: CfTypes.DurableObjectState
declare const syncBackendNamespace: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>

export const syncBackend = makeDoRpcSync({
  getSyncBackendStub: () => syncBackendNamespace.getByName('my-store'),
  durableObjectState: state,
  durableObjectContext: {
    bindingName: 'CLIENT_DO',
    durableObjectId: state.id.toString(),
  },
})
