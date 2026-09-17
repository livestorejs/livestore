import type { SyncBackend, UnknownError } from '@livestore/common'
import { Context, type Effect, type HttpClient, type Layer, type Schedule } from '@livestore/utils/effect'

/**
 * Vitest budget for `beforeAll`/`afterAll` hooks that boot a provider runtime.
 *
 * Must exceed the wrangler boot budget inside `WranglerDevServer` (30s per attempt
 * + 1 retry in CI, plus the HTTP connectivity check): vitest's default
 * `hookTimeout` of 10s is lower than that, so a slow workerd cold start would
 * otherwise kill the whole suite (suite-level `{ timeout }` options do not apply
 * to hooks).
 */
export const HOOK_TIMEOUT_MS = 120_000

export interface SyncProviderOptions {
  pingSchedule?: Schedule.Schedule<unknown>
}

export class SyncProviderImpl extends Context.Service<
  SyncProviderImpl,
  {
    // TODO support simulatation of latency and offline mode etc
    makeProvider: (
      args: SyncBackend.MakeBackendArgs,
      options?: SyncProviderOptions,
    ) => ReturnType<SyncBackend.SyncBackendConstructor<any>>
    turnBackendOffline: Effect.Effect<void>
    turnBackendOnline: Effect.Effect<void>
    providerSpecific: { port?: number }
  }
>()('SyncProviderImpl') {}

export type SyncProviderLayer = Layer.Layer<SyncProviderImpl, UnknownError, HttpClient.HttpClient>
