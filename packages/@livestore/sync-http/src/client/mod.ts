import type { SyncBackend } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { Effect, identity, Mailbox, Socket, Stream } from '@livestore/utils/effect'
import { ConnectionManager } from './connection-manager.ts'

export const makeSyncBackend = (options: { readonly baseUrl: string }): SyncBackend.SyncBackendConstructor =>
  Effect.fnUntraced(function* ({ storeId }) {
    const manager = yield* ConnectionManager.make({
      baseUrl: options.baseUrl,
      storeId,
    }).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))

    return identity<SyncBackend.SyncBackend>({
      connect: manager.connect,
      pull: (cursor, options) =>
        manager
          .pull({
            cursor: cursor._tag === 'Some' ? cursor.value.eventSequenceNumber : EventSequenceNumber.Global.make(-1),
            live: options?.live ?? false,
          })
          .pipe(Effect.map(Mailbox.toStream), Stream.unwrapScoped),
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
