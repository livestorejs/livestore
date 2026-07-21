import path from 'node:path'

import { SyncBackend, UnknownError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/common/schema'
import { MAX_DO_RPC_REQUEST_BYTES, MAX_PUSH_EVENTS_PER_REQUEST, splitArrayBySize } from '@livestore/sync-cf/common'
import { WranglerDevServer } from '@livestore/utils-dev/wrangler'
import type { RpcClientError } from '@livestore/utils/effect'
import {
  Effect,
  Layer,
  Option,
  ReadonlyArray as EffectArray,
  RpcClient,
  RpcSerialization,
  type Schedule,
  Socket,
  Stream,
  Struct,
  SubscriptionRef,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { SyncProviderImpl, type SyncProviderLayer } from '../types.ts'
import { DoRpcProxyRpcs } from './cloudflare/do-rpc-proxy-schema.ts'

export const name = 'Cloudflare Durable Object RPC'

export const prepare = Effect.void

type DoRpcProxyClient = RpcClient.FromGroup<typeof DoRpcProxyRpcs, RpcClientError.RpcClientError>
type PushBatchItem = LiveStoreEvent.Global.Encoded

const makeLayer = (config?: { wranglerConfigPath?: string; label: string }): SyncProviderLayer =>
  Layer.effect(
    SyncProviderImpl,
    Effect.gen(function* () {
      const server = yield* WranglerDevServer.WranglerDevServer

      return {
        makeProvider: (args, options) =>
          makeProxyDoRpcSync({
            port: server.port,
            pingSchedule: options?.pingSchedule,
          })(args),
        turnBackendOffline: Effect.log('TODO implement turnBackendOffline'),
        turnBackendOnline: Effect.log('TODO implement turnBackendOnline'),
        providerSpecific: { port: server.port },
      }
    }),
  ).pipe(
    Layer.provide(
      WranglerDevServer.layer({
        cwd: path.join(import.meta.dirname, 'cloudflare'),
        ...(config?.wranglerConfigPath && { wranglerConfigPath: config.wranglerConfigPath }),
      }).pipe(Layer.provide(PlatformNode.NodeServices.layer)),
    ),
    UnknownError.mapToUnknownErrorLayer,
  )

export const d1 = {
  name: `${name} (D1)`,
  layer: makeLayer({
    label: 'D1',
    wranglerConfigPath: path.join(import.meta.dirname, 'cloudflare', 'wrangler-d1.toml'),
  }),
  prepare,
}
export const doSqlite = {
  name: `${name} (DO)`,
  layer: makeLayer({
    wranglerConfigPath: path.join(import.meta.dirname, 'cloudflare', 'wrangler-do-sqlite.toml'),
    label: 'DO',
  }),
  prepare,
}

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
const makeProxyDoRpcSync = ({
  port,
  pingSchedule,
}: {
  port: number
  pingSchedule?: Schedule.Schedule<unknown> | undefined
}): SyncBackend.SyncBackendConstructor<any> =>
  // TODO pass through clientId, payload, storeId to worker/DO
  Effect.fn(function* ({ clientId, storeId, payload }) {
    const socketConnectionRef = yield* SubscriptionRef.make(false)

    const ProtocolLive = RpcClient.layerProtocolSocketWithIsConnected({
      url: `ws://localhost:${port}/do-rpc-ws-proxy`,
      isConnected: socketConnectionRef,
      pingSchedule,
    }).pipe(
      Layer.provide(Socket.layerWebSocket(`ws://localhost:${port}/do-rpc-ws-proxy`)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )

    // Warning: we need to build the layer here eagerly to tie it to the scope
    // instead of using `Effect.provide(ProtocolLive)` which would close the layer scope too early
    const ctx = yield* Layer.build(ProtocolLive)

    const client: DoRpcProxyClient = yield* RpcClient.make(DoRpcProxyRpcs).pipe(Effect.provide(ctx))

    const isConnected = yield* SubscriptionRef.fromStream(
      client.IsConnected({ clientId, storeId, payload }).pipe(Stream.catchTag('RpcClientError', (e) => Stream.die(e))),
      false,
    )

    const metadata = yield* client.GetMetadata({ clientId, storeId, payload })
    const backendIdHelper = yield* SyncBackend.makeBackendIdHelper

    return SyncBackend.of({
      connect: client
        .Connect({ clientId, storeId, payload })
        .pipe(Effect.catchTag('RpcClientError', (e) => Effect.die(e))),
      isConnected,
      pull: (cursor, options) =>
        client
          .Pull({
            clientId,
            storeId,
            payload,
            cursor: cursor.pipe(
              Option.map((a) => ({
                eventSequenceNumber: a.eventSequenceNumber,
                backendId: backendIdHelper.get().pipe(Option.getOrThrow),
              })),
            ),
            live: options?.live ?? false,
          })
          .pipe(
            Stream.tap((msg) => backendIdHelper.lazySet(msg.backendId).pipe(Effect.orDie)),
            Stream.map((res) => Struct.omit(res, ['backendId'])),
            Stream.catchTag('RpcClientError', (e) => Stream.die(e)),
          ),
      push: (batch) =>
        Effect.gen(function* () {
          if (batch.length === 0) {
            return
          }

          if (EffectArray.isReadonlyArrayNonEmpty(batch) === false) {
            return
          }

          const chunkedBatches = yield* splitArrayBySize({
            maxItems: MAX_PUSH_EVENTS_PER_REQUEST,
            maxBytes: MAX_DO_RPC_REQUEST_BYTES,
            encode: (items: ReadonlyArray<PushBatchItem>) => ({
              clientId,
              storeId,
              payload,
              batch: items,
            }),
          })(batch)

          for (const batchChunk of chunkedBatches) {
            yield* client.Push({
              clientId,
              storeId,
              payload,
              batch: batchChunk,
            })
          }
        }).pipe(Effect.withSpan('proxy-do-rpc-sync:push'), Effect.orDie),
      ping: client.Ping({ clientId, storeId, payload }).pipe(Effect.catchTag('RpcClientError', (e) => Effect.die(e))),
      metadata,
      supports: {
        pullPageInfoKnown: true,
        pullLive: true,
      },
    })
  }, Effect.orDie)
