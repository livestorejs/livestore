import type { SyncBackend } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/livestore'
import { Context, type Effect } from '@livestore/utils/effect'

export class SyncProviderImpl extends Context.Tag('SyncProviderImpl')<
  SyncProviderImpl,
  {
    // TODO support simulatation of latency and offline mode etc
    makeProvider: SyncBackend.SyncBackendConstructor<any>
    turnBackendOffline: Effect.Effect<void>
    turnBackendOnline: Effect.Effect<void>
    push: (events: LiveStoreEvent.AnyEncodedGlobal[]) => Effect.Effect<void>
  }
>() {}
