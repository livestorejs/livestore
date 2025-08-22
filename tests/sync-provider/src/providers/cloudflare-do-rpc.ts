import path from 'node:path'
import { SyncBackend } from '@livestore/common'
import { Effect, Layer, RpcClient, RpcSerialization, Socket, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { startWranglerDevServer } from '@livestore/utils-dev/node-vitest'
import { SyncProviderImpl } from '../types.ts'
import { DoRpcProxyRpcs } from './cloudflare/do-rpc-proxy-schema.ts'

export const name = 'Cloudflare Durable Object RPC'

export const layer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const { port } = yield* startWranglerDevServer({ cwd: path.join(import.meta.dirname, 'cloudflare') })

    return {
      makeProvider: makeProxyDoRpcSync({ port }),
      turnBackendOffline: Effect.log('TODO implement turnBackendOffline'),
      turnBackendOnline: Effect.log('TODO implement turnBackendOnline'),
      push: () => Effect.log('TODO implement push'),
    }
  }),
)

/**
 * Given we can't use the DO RPC sync provider client only within a Durable Object,
 * we need to proxy the sync provider client from the Vitest test runner to a Durable Object.
 * We do this via a WS RPC connection between the Vitest test runner and a TestClientDO.
 *
 *
 *   ┌─────────────┐               ┌─────────────────┐
 *   │ Test Client │ ────────────▶ │ Worker (router) │
 *   │  (vitest)   │               └─────────────────┘
 *   └────┬────────┘                        │
 *        │                                 │
 *        │                                 ▼
 *        │                        ┌───────────────────────┐                 ┌────────────────────┐
 *        │     WS RPC             │    Test Client DO     │                 │  Sync Backend DO   │
 *        └────────────────────────┤layerRpcServerWebsocket│ ◀─── DO RPC ──▶ │  (Server Layer)    │
 *                                 └───────────────────────┘                 └────────────────────┘
 */
const makeProxyDoRpcSync = ({ port }: { port: number }): SyncBackend.SyncBackendConstructor<any> =>
  // TODO pass through clientId, payload, storeId to worker/DO
  Effect.fn(function* ({ clientId, storeId, payload }) {
    const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(`ws://localhost:${port}/do-rpc-ws-proxy`)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )

    // Warning: we need to build the layer here eagerly to tie it to the scope
    // instead of using `Effect.provide(ProtocolLive)` which would close the layer scope too early
    const ctx = yield* Layer.build(ProtocolLive)

    const client = yield* RpcClient.make(DoRpcProxyRpcs).pipe(Effect.provide(ctx))

    const isConnected = yield* SubscriptionRef.fromStream(
      client.IsConnected({ clientId, storeId, payload }).pipe(Stream.catchTag('RpcClientError', (e) => Effect.die(e))),
      false,
    )

    const metadata = yield* client.GetMetadata({ clientId, storeId, payload })

    return SyncBackend.of({
      connect: client
        .Connect({ clientId, storeId, payload })
        .pipe(Effect.catchTag('RpcClientError', (e) => Effect.die(e))),
      isConnected,
      pull: (args, options) =>
        client
          .Pull({ clientId, storeId, payload, args, live: options?.live ?? false })
          .pipe(Stream.catchTag('RpcClientError', (e) => Stream.die(e))),
      push: (batch) =>
        client
          .Push({ clientId, storeId, payload, batch })
          .pipe(Effect.catchTag('RpcClientError', (e) => Effect.die(e))),
      ping: client.Ping({ clientId, storeId, payload }).pipe(Effect.catchTag('RpcClientError', (e) => Effect.die(e))),
      metadata,
      supports: {
        pullPageInfoKnown: true,
        pullLive: true,
      },
    })
  }, Effect.orDie)
