import type { SyncBackend } from '@livestore/common'
import { Context } from '@livestore/utils/effect'

export class SyncProviderImpl extends Context.Tag('SyncProviderImpl')<
  SyncProviderImpl,
  {
    // TODO support simulatation of latency and offline mode etc
    makeProvider: SyncBackend.SyncBackendConstructor<any>
  }
>() {}
