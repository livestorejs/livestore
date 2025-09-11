import type { SyncBackend, UnexpectedError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/livestore'
import { Context, type Effect, type HttpClient, type Layer } from '@livestore/utils/effect'

export class SyncProviderImpl extends Context.Tag('SyncProviderImpl')<
  SyncProviderImpl,
  {
    // TODO support simulatation of latency and offline mode etc
    makeProvider: SyncBackend.SyncBackendConstructor<any>
    turnBackendOffline: Effect.Effect<void>
    turnBackendOnline: Effect.Effect<void>
    push: (events: LiveStoreEvent.AnyEncodedGlobal[]) => Effect.Effect<void>
    // Provider-specific testing utilities (optional)
    getDbForTesting?: (storeId: string) => {
      migrate: Effect.Effect<void, unknown>
      disconnect: Effect.Effect<void, unknown>
      sql: any
      tableName: string
    }
  }
>() {}

export type SyncProviderLayer = Layer.Layer<SyncProviderImpl, UnexpectedError, HttpClient.HttpClient>
