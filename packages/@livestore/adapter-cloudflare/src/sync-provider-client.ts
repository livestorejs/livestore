import type { SyncBackendConstructor } from '@livestore/common'
import { makeCfSync } from '@livestore/sync-cf'
import type { WSMessage } from '@livestore/sync-cf/common'
import { Effect, Schedule, type Scope, type WebSocket } from '@livestore/utils/effect'
import type * as CfWorker from './cf-types.ts'
import { makeWebSocket } from './WebSocket.ts'

export type MakeDurableObjectSyncBackendOptions = {
  /** WebSocket URL to connect to the sync backend Durable Object */
  durableObject: CfWorker.DurableObjectStub
}

/**
 * Specialized sync backend used for Cloudflare Workers compatible only with `@livestore/sync-cf`
 */
export const makeSyncProviderClient =
  ({ durableObject }: MakeDurableObjectSyncBackendOptions): SyncBackendConstructor<WSMessage.SyncMetadata> =>
  (args) => {
    // Create a WebSocket factory that uses Cloudflare Durable Objects
    const webSocketFactory = (
      wsUrl: string,
    ): Effect.Effect<globalThis.WebSocket, WebSocket.WebSocketError, Scope.Scope> =>
      Effect.gen(function* () {
        const url = new URL(wsUrl)
        const socket = yield* makeWebSocket({
          durableObject,
          url,
          reconnect: Schedule.exponential(100),
        })
        return socket as unknown as globalThis.WebSocket
      })

    // Use the unified ws-impl with the Cloudflare WebSocket factory
    return makeCfSync({
      url: 'https://unused.com', // URL is constructed internally by ws-impl
      webSocketFactory,
    })(args)
  }
