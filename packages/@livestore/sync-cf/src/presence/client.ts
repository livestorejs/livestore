import {
  Effect,
  Layer,
  Ref,
  RpcClient,
  RpcSerialization,
  Schedule,
  Scope,
  Socket,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { SyncWsRpc } from '../common/ws-rpc-schema.ts'
import type { PresenceSnapshot } from './schema.ts'

export interface PresenceClientOptions {
  /** Sync backend URL (same endpoint the LiveStore worker uses). */
  url: string
  storeId: string
  clientId: string
  name?: string
  payload?: unknown
  /** How often to heartbeat so the party keeps this client alive. */
  heartbeatIntervalMs?: number
  /** Coalescing window in ms for cursor/drag streams. @default 40 */
  throttleIntervalMs?: number
}

/** Patch of ephemeral presence state. `undefined`/`null` values clear the key. */
export type PresenceStatePatch = Record<string, unknown>

export interface PresenceClient<TChannels extends Record<string, any>> {
  readonly storeId: string
  readonly clientId: string
  snapshots: <K extends keyof TChannels & string>(channel: K) => Stream.Stream<PresenceSnapshot, never>
  snapshotRef: <K extends keyof TChannels & string>(
    channel: K,
  ) => SubscriptionRef.SubscriptionRef<PresenceSnapshot>
  /** Set fields on this client's presence state for `channel`. `undefined`/`null` values clear the key. */
  /** Set fields on this client's presence state for `channel`. */
  setState: (channel: string, patch: Record<string, unknown>) => Effect.Effect<void>
  leave: Effect.Effect<void>
}

/**
 * Ephemeral presence client attached to the sync party.
 *
 * Sends FULL accumulated state (not patches) so clearing a field (e.g.
 * dropping a drag) is reliably reflected on the server. Re-joins all channels
 * on socket reconnect.
 */
export const makePresenceClient = <TChannels extends Record<string, any>>(
  options: PresenceClientOptions & { channels: TChannels },
): Effect.Effect<PresenceClient<TChannels>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const channelNames = Object.keys(options.channels)
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000
    const throttleIntervalMs = options.throttleIntervalMs ?? 40

    const snapshotRefs = yield* Ref.make(new Map<string, SubscriptionRef.SubscriptionRef<PresenceSnapshot>>())

    const getSnapshotRef = Effect.fnUntraced(function* (channel: string) {
      const existing = (yield* Ref.get(snapshotRefs)).get(channel)
      if (existing !== undefined) return existing
      const ref = yield* SubscriptionRef.make<PresenceSnapshot>({
        storeId: options.storeId,
        channel,
        members: [],
      })
      yield* Ref.update(snapshotRefs, (map) => new Map(map).set(channel, ref))
      return ref
    })

    // Full accumulated state per channel (not patches). `setState` merges into
    // this; `undefined`/`null` values delete keys. Flush sends the whole thing.
    const stateRef = yield* Ref.make(new Map<string, Record<string, unknown>>())
    const throttledRef = yield* Ref.make(new Map<string, { last: number }>())

    const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(
        Socket.layerWebSocket(
          `${options.url}?storeId=${encodeURIComponent(options.storeId)}&transport=ws${options.payload !== undefined ? `&payload=${encodeURIComponent(JSON.stringify(options.payload))}` : ''}`,
        ),
      ),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )

    const ctx = yield* Layer.build(ProtocolLive)
    const rpcClient = yield* RpcClient.make(SyncWsRpc).pipe(Effect.provide(ctx))

    const joinAll = Effect.forEach(channelNames, (channel) =>
      rpcClient['SyncWsRpc.PresenceJoin']({
        storeId: options.storeId,
        channel,
        clientId: options.clientId,
        name: options.name,
      }).pipe(Effect.ignore),
    )

    const subscribeAll = Effect.forEach(channelNames, (channel) =>
      rpcClient['SyncWsRpc.PresenceSnapshots']({ storeId: options.storeId, channel }).pipe(
        Stream.mapEffect((snapshot) =>
          Effect.gen(function* () {
            const ref = yield* getSnapshotRef(channel)
            yield* SubscriptionRef.set(ref, snapshot)
          }),
        ),
        Stream.runDrain,
        Effect.interruptible,
        Effect.ignore,
      ),
    )

    // Join + subscribe now.
    yield* joinAll
    yield* Effect.forkDetach(subscribeAll)

    const sendState = (channel: string) =>
      Effect.gen(function* () {
        const state = (yield* Ref.get(stateRef)).get(channel)
        if (state === undefined) return
        yield* rpcClient['SyncWsRpc.PresenceUpdate']({
          storeId: options.storeId,
          channel,
          clientId: options.clientId,
          patch: state as any,
        }).pipe(Effect.ignore)
      })

    const flushChannel = (channel: string) =>
      Effect.gen(function* () {
        const last = (yield* Ref.get(throttledRef)).get(channel)?.last ?? 0
        if (Date.now() - last < throttleIntervalMs) return
        yield* Ref.update(throttledRef, (map) => new Map(map).set(channel, { last: Date.now() }))
        yield* sendState(channel)
      })

    // Heartbeat: send full state for all channels so the party keeps this
    // client alive. Detached: runs for the process lifetime.
    yield* Effect.forkDetach(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(heartbeatIntervalMs)
          for (const channel of channelNames) {
            yield* sendState(channel)
          }
        }
      }).pipe(Effect.interruptible, Effect.ignore),
    )

    return {
      storeId: options.storeId,
      clientId: options.clientId,

      snapshotRef: ((channel: string) => Effect.runSync(getSnapshotRef(channel))) as any,

      snapshots: ((channel: string) =>
        Effect.map(getSnapshotRef(channel), (ref) => SubscriptionRef.changes(ref)).pipe(
          Stream.unwrap,
        )) as any,

      setState: (((channel: string, patch: Record<string, unknown>) =>
        Effect.gen(function* () {
          const prevState = (yield* Ref.get(stateRef)).get(channel) ?? {}
          // Merge patch; `undefined`/`null` values delete keys.
          const next: Record<string, unknown> = { ...prevState }
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === null) {
              delete next[key]
            } else {
              next[key] = value
            }
          }
          yield* Ref.update(stateRef, (map) => new Map(map).set(channel, next))
          yield* flushChannel(channel)
        }).pipe(Effect.ignore)) as any),

      leave: Effect.gen(function* () {
        yield* Effect.forEach(channelNames, (channel) =>
          rpcClient['SyncWsRpc.PresenceLeave']({
            storeId: options.storeId,
            channel,
            clientId: options.clientId,
          }).pipe(Effect.ignore),
        )
      }),
    }
  })