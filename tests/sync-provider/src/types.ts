import type { SyncBackend, UnknownError } from '@livestore/common'
import { Context, type Effect, type HttpClient, type Layer, type Schedule } from '@livestore/utils/effect'

export interface SyncProviderOptions {
  pingSchedule?: Schedule.Schedule<unknown>
}

export class SyncProviderImpl extends Context.Tag('SyncProviderImpl')<
  SyncProviderImpl,
  {
    // TODO support simulatation of latency and offline mode etc
    makeProvider: (
      args: SyncBackend.MakeBackendArgs,
      options?: SyncProviderOptions,
    ) => ReturnType<SyncBackend.SyncBackendConstructor<any>>
    turnBackendOffline: Effect.Effect<void>
    turnBackendOnline: Effect.Effect<void>
    providerSpecific: any
  }
>() {}

export type SyncProviderLayer = Layer.Layer<SyncProviderImpl, UnknownError, HttpClient.HttpClient>
