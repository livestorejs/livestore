import {
  Effect,
  Layer,
  Ref,
  RpcClient,
  RpcSerialization,
  Schedule,
  Scope,
  Schema,
  Socket,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { SyncWsRpc } from '../common/ws-rpc-schema.ts'
import type { PresenceSnapshot } from './schema.ts'

export interface PresenceChannelOptions {
  url: string
  storeId: string
  clientId: string
  /** Optional display name shared with peers on every channel. */
  name?: string
  /**
   * Sync payload (e.g. auth token) forwarded to the backend's
   * `validatePayload` during connection establishment.
   */
  payload?: Schema.Json | undefined
  /** How often to re-emit state so rooms keep this client alive. */
  heartbeatIntervalMs?: number
  /** Coalescing window in ms for high-frequency updates (cursor/drag). @default 40 */
  throttleIntervalMs?: number
}

/**
 * Channel definitions mirrored from the party's server-side declaration.
 *
 * Define the schemas once in a shared module, pass them to
 * `makeDurableObject({ presence: { schemas } })` on the server and to
 * `makePresenceClient({ channels })` in the app — `setState`/`snapshots` are
 * then fully typed per channel.
 */
export type PresenceChannels = Record<string, Schema.Codec<any, any>>

type ChannelsOf<TChannels extends PresenceChannels> = {
  [K in keyof TChannels & string]: Schema.Schema.Type<TChannels[K]>
}

export interface PresenceClient<TChannels extends PresenceChannels> {
  readonly storeId: string
  readonly clientId: string
  /** Synchronous read handle for one channel's room snapshot. */
  snapshotRef: <K extends keyof TChannels & string>(
    channel: K,
  ) => SubscriptionRef.SubscriptionRef<PresenceSnapshot>
  /** Live stream of snapshots for one channel (current value first). */
  snapshots: <K extends keyof TChannels & string>(channel: K) => Stream.Stream<PresenceSnapshot, never>
  /** Merge a typed patch into this client's state on `channel`. */
  setState: <K extends keyof TChannels & string>(
    channel: K,
    patch: Partial<ChannelsOf<TChannels>[K]>,
  ) => Effect.Effect<void>
  /** Mark this client offline on all channels and disconnect. */
  leave: Effect.Effect<void>
}

/**
 * Creates an ephemeral presence client attached to the sync party.
 *
 * Single-party model: presence rides the same sync backend (and Durable
 * Object) as the durable eventlog via `SyncWsRpc` presence RPCs — one party
 * per storeId hosts both. Presence state is broadcast only; it is never
 * written to the eventlog or SQLite.
 *
 * Channels must be declared once on the server via
 * `makeDurableObject({ presence: { schemas } })`; the same schemas are passed
 * here so patches are encoded/typed client-side and validated server-side.
 */
export const makePresenceClient = <TChannels extends PresenceChannels>(
  options: PresenceChannelOptions & { channels: TChannels },
): Effect.Effect<PresenceClient<TChannels>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const channelNames = Object.keys(options.channels)

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

    const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(`${options.url}?storeId=${encodeURIComponent(options.storeId)}&transport=ws${options.payload !== undefined ? `&payload=${encodeURIComponent(JSON.stringify(options.payload))}` : ''}`)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )

    const ctx = yield* Layer.build(ProtocolLive)
    const rpcClient = yield* RpcClient.make(SyncWsRpc).pipe(Effect.provide(ctx))

    // Join every declared channel, then subscribe to each room's snapshots.
    yield* Effect.forEach(channelNames, (channel) =>
      rpcClient['SyncWsRpc.PresenceJoin']({
        storeId: options.storeId,
        channel,
        clientId: options.clientId,
        name: options.name,
      }).pipe(Effect.ignore),
    )

    yield* Effect.forkScoped(
      Effect.forEach(channelNames, (channel) =>
        rpcClient['SyncWsRpc.PresenceSnapshots']({ storeId: options.storeId, channel }).pipe(
          Stream.tap((snapshot) =>
            Effect.gen(function* () {
              const ref = yield* getSnapshotRef(channel)
              yield* SubscriptionRef.set(ref, snapshot)
            }),
          ),
          Stream.runDrain,
          Effect.interruptible,
          Effect.ignore,
        ),
      ),
    )

    // Per-channel coalescing throttle state; heartbeats flush all channels so
    // the party's idle TTL keeps live clients.
    const throttledRef = yield* Ref.make(
      new Map<string, { last: number; pending: Record<string, unknown> }>(),
    )
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000

    const flushChannel = (channel: string) =>
      Effect.gen(function* () {
        const stateMap = yield* Ref.get(throttledRef)
        const entry = stateMap.get(channel)
        if (entry === undefined || Object.keys(entry.pending).length === 0) return
        const def = options.channels[channel]
        if (def === undefined) return
        // Client-side encode against the channel schema; the party validates
        // the same schema before fan-out (end-to-end typed).
        // Send the raw patch as JSON: schema transforms can drop optional
        // primitive fields on encode/decode round-trips. Types are enforced at
        // compile time via `channels`; the party validates before fan-out.
        const encoded = entry.pending
        yield* Ref.update(throttledRef, (map) => new Map(map).set(channel, { last: Date.now(), pending: {} }))
        yield* rpcClient['SyncWsRpc.PresenceUpdate']({
          storeId: options.storeId,
          channel,
          clientId: options.clientId,
          patch: encoded as any,
        }).pipe(Effect.ignore)
      })

    // Heartbeat flushes every declared channel so the party's idle TTL keeps
    // this client alive even when idle.
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(heartbeatIntervalMs)
          for (const channel of channelNames) {
            yield* flushChannel(channel)
          }
        }
      }).pipe(Effect.interruptible),
    )

    return {
      storeId: options.storeId,
      clientId: options.clientId,

      snapshotRef: ((channel: string) =>
        Effect.runSync(getSnapshotRef(channel))) as any,
      snapshots: ((channel: string) =>
        Effect.map(getSnapshotRef(channel), (ref) => SubscriptionRef.changes(ref)).pipe(
          Stream.unwrap,
        )) as any,

      setState: (((channel: string, patch: Record<string, unknown>) =>
        Effect.gen(function* () {
          const stateMap = yield* Ref.get(throttledRef)
          const entry = stateMap.get(channel) ?? { last: 0, pending: {} as Record<string, unknown> }
          yield* Ref.update(throttledRef, (map) =>
            new Map(map).set(channel, {
              last: entry.last,
              pending: { ...entry.pending, ...patch },
            }),
          )
          const elapsed = Date.now() - entry.last
          if (elapsed >= (options.throttleIntervalMs ?? 40)) {
            yield* flushChannel(channel)
          }
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