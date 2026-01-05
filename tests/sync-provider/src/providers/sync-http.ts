import { UnknownError } from '@livestore/common'
import { makeHttpSync } from '@livestore/sync-http/client'
import type { TransportConfig } from '@livestore/sync-http/common'
import { createSyncServer } from '@livestore/sync-http/server'
import { Effect, Layer } from '@livestore/utils/effect'
import { SyncProviderImpl, type SyncProviderLayer } from '../types.ts'

export const name = 'Sync HTTP'

export const prepare = Effect.void

export type ProviderSpecific = {
  /** Get the server URL for direct HTTP testing */
  getServerUrl: () => string
}

const makeLayer = (options: {
  label: string
  transports?: TransportConfig
  responseHeaders?: Record<string, string>
}): SyncProviderLayer =>
  Layer.scoped(
    SyncProviderImpl,
    Effect.gen(function* () {
      // Start the server with port 0 to let the OS assign a random available port
      const server = yield* Effect.tryPromise({
        try: () =>
          createSyncServer({
            port: 0,
            storage: { type: 'memory' },
            transports: options.transports,
            responseHeaders: options.responseHeaders,
          }),
        catch: (cause) => new UnknownError({ cause }),
      })

      // Cleanup on scope finalization
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => server.stop(),
          catch: (cause) => new UnknownError({ cause }),
        }).pipe(Effect.ignore),
      )

      // Replace 0.0.0.0 with 127.0.0.1 for client connections
      const clientUrl = server.url.replace('0.0.0.0', '127.0.0.1')

      const providerSpecific: ProviderSpecific = {
        getServerUrl: () => clientUrl,
      }

      return {
        makeProvider: makeHttpSync({
          url: clientUrl,
          livePull: {
            // For testing purposes, use a short poll interval
            pollInterval: 200,
          },
        }),
        // Note: With memory storage, state is lost when the server restarts.
        // The reconnection test expects client-side retry logic which isn't implemented yet.
        // For now, we use no-op implementations like other providers.
        turnBackendOffline: Effect.log('TODO implement turnBackendOffline for sync-http'),
        turnBackendOnline: Effect.log('TODO implement turnBackendOnline for sync-http'),
        providerSpecific,
      }
    }),
  ).pipe(UnknownError.mapToUnknownErrorLayer)

/** Sync HTTP provider with Memory storage (polling for live updates) */
export const memory = {
  name: `${name} (Memory)`,
  layer: makeLayer({ label: 'Memory' }),
  prepare,
}

/** Sync HTTP provider with Memory storage and SSE for live updates */
export const memorySse = {
  name: `${name} (Memory+SSE)`,
  layer: makeLayer({
    label: 'Memory+SSE',
    transports: { http: { livePull: 'sse' } },
  }),
  prepare,
}

/** Get provider-specific utilities from a SyncProviderImpl */
export const getProviderSpecific = (provider: typeof SyncProviderImpl.Service): ProviderSpecific =>
  provider.providerSpecific as ProviderSpecific
