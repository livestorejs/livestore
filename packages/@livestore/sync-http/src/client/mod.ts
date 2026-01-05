import type { SyncBackend } from '@livestore/common'
import { Effect, FetchHttpClient, identity, Option, Socket } from '@livestore/utils/effect'
import { ConnectionManager } from './connection-manager.ts'

export const makeSyncBackend = (options: {
  readonly baseUrl: string
  readonly protocol?: 'websocket' | 'http' | undefined
}): SyncBackend.SyncBackendConstructor =>
  Effect.fnUntraced(function* ({ storeId, clientId }) {
    const manager = yield* ConnectionManager.make({
      baseUrl: options.baseUrl,
      storeId,
      clientId,
      protocol: options.protocol ?? 'websocket',
    }).pipe(Effect.provide([Socket.layerWebSocketConstructorGlobal, FetchHttpClient.layer]))

    return identity<SyncBackend.SyncBackend>({
      connect: manager.connect,
      pull: (cursor, options) =>
        manager.pull({
          cursor: Option.map(cursor, (_) => _.eventSequenceNumber),
          live: options?.live ?? false,
        }),
      push: (events) => manager.push(events),
      ping: manager.ping.pipe(Effect.timeout('10 seconds')),
      isConnected: manager.isConnected,
      metadata: {
        name: '@livestore/sync-http',
        description: 'Sync backend using HTTP and WebSocket transport',
      },
      supports: {
        pullPageInfoKnown: false,
        pullLive: true,
      },
    })
  })
