import {
  Effect,
  Layer,
  RpcClient,
  RpcSerialization,
  Scope,
  Socket,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { PresenceWsRpc } from '../cf-worker/presence-rpc-schema.ts'
import type { PresenceClient } from './client.ts'
import { PresenceSnapshot, PresenceState } from './schema.ts'

export interface PresenceWsClientOptions {
  /** WS URL of the presence DO, e.g. `wss://example.com/presence`. */
  url: string
  storeId: string
  clientId: string
  name?: string
}

/**
 * Creates a `PresenceClient` backed by the Cloudflare `PresenceDurableObject`
 * over the standard WS RPC transport.
 *
 * The DO holds the in-memory room per `storeId`; this client subscribes to the
 * `Snapshots` stream and forwards `Join`/`Update`/`Leave`. Presence is
 * ephemeral — never persisted.
 */
export const makePresenceWsClient = (
  options: PresenceWsClientOptions,
): Effect.Effect<PresenceClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const url = new URL(options.url)
    url.searchParams.set('storeId', options.storeId)

    const snapshotRef = yield* SubscriptionRef.make<PresenceSnapshot>({
      storeId: options.storeId,
      clients: [],
    })

    const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(url.toString())),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )

    const ctx = yield* Layer.build(ProtocolLive)
    const rpcClient = yield* RpcClient.make(PresenceWsRpc).pipe(Effect.provide(ctx))

    yield* rpcClient['PresenceWsRpc.Join']({
      storeId: options.storeId,
      clientId: options.clientId,
      name: options.name,
    }).pipe(Effect.catch(() => Effect.void))

    yield* Effect.forkScoped(
      rpcClient['PresenceWsRpc.Snapshots']({ storeId: options.storeId }).pipe(
        Stream.tap((snapshot) => SubscriptionRef.set(snapshotRef, snapshot)),
        Stream.runDrain,
        Effect.interruptible,
        Effect.catch(() => Effect.void),
      ),
    )

    const update = (
      patch: Omit<Partial<PresenceState>, 'clientId' | 'online' | 'updatedAt'>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = snapshotRef.value.clients.find((c) => c.clientId === options.clientId)
        yield* rpcClient['PresenceWsRpc.Update']({
          storeId: options.storeId,
          state: {
            clientId: options.clientId,
            name: options.name,
            online: true,
            typing: patch.typing ?? current?.typing,
            cursor: patch.cursor ?? current?.cursor,
            textCursor: patch.textCursor ?? current?.textCursor,
            updatedAt: Date.now(),
          },
        }).pipe(Effect.catch(() => Effect.void))
      })

    const result: PresenceClient = {
      storeId: options.storeId,
      clientId: options.clientId,
      snapshot: snapshotRef,
      snapshots: SubscriptionRef.changes(snapshotRef),
      setState: update,
      setCursor: (x, y) => update({ cursor: { x, y } }),
      setTyping: (typing) => update({ typing }),
      setTextCursor: (offset) => update({ textCursor: offset }),
      leave: Effect.gen(function* () {
        yield* rpcClient['PresenceWsRpc.Leave']({ storeId: options.storeId, clientId: options.clientId }).pipe(
          Effect.catch(() => Effect.void),
        )
      }),
    }
    return result
  }).pipe(Effect.catch((cause) => Effect.die(cause)))

export { PresenceWsRpc }
export type { PresenceClient }