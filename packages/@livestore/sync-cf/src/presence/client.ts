import {
  Effect,
  Layer,
  Ref,
  RpcClient,
  RpcSerialization,
  Schedule,
  Schema,
  Scope,
  Socket,
  Stream,
  SubscriptionRef,
} from '@livestore/utils/effect'

import { SyncWsRpc } from '../common/ws-rpc-schema.ts'
import { PresenceSnapshot, PresenceState } from './schema.ts'

export interface PresenceClientOptions {
  /**
   * URL of the sync backend hosting the presence room — the same endpoint the
   * LiveStore worker connects to for eventlog sync (single-party model).
   *
   * The storeId + transport sync search params are appended automatically so
   * the request routes to the party DO.
   *
   * @example 'wss://example.com/sync'
   */
  url: string
  storeId: string
  clientId: string
  /** Optional display name shared with peers. */
  name?: string
  /**
   * Sync payload (e.g. auth token) forwarded to the backend's
   * `validatePayload` during connection establishment. Should match what the
   * app's sync backend expects.
   */
  payload?: Schema.Json | undefined
  /** How often to re-emit local state so the room keeps the client alive. */
  heartbeatIntervalMs?: number
  /** Coalescing window in ms for high-frequency updates (cursor/drag). @default 40 */
  throttleIntervalMs?: number
}

export interface PresenceClient {
  readonly storeId: string
  readonly clientId: string
  readonly snapshot: SubscriptionRef.SubscriptionRef<PresenceSnapshot>
  /** Live stream of room snapshots. */
  readonly snapshots: Stream.Stream<PresenceSnapshot, never>
  /** Send a state update (cursor, typing, textCursor, dragging, name…). */
  setState: (patch: Omit<Partial<PresenceState>, 'clientId' | 'online' | 'updatedAt'>) => Effect.Effect<void>
  /** Convenience for Figma-style cursor movement at high frequency. */
  setCursor: (x: number, y: number) => Effect.Effect<void>
  /** Convenience for the typing indicator. */
  setTyping: (typing: boolean) => Effect.Effect<void>
  /** Change the display name shown on this client's cursor. */
  setName: (name: string) => Effect.Effect<void>
  /** Broadcast that the client is dragging a card (PartyKit-style live drag). */
  setDragging: (drag: { cardId: string; deltaX: number; deltaY: number } | undefined) => Effect.Effect<void>
  /** Mark the client offline and disconnect. */
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
 * The client heartbeats its state so the room prunes silently disconnected
 * peers; updates coalesce per throttle window to keep the socket quiet.
 */
export const makePresenceClient = (
  options: PresenceClientOptions,
): Effect.Effect<PresenceClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const snapshotRef = yield* SubscriptionRef.make<PresenceSnapshot>({
      storeId: options.storeId,
      clients: [],
    })

    const payloadParam =
      options.payload !== undefined
        ? `&payload=${encodeURIComponent(JSON.stringify(options.payload))}`
        : ''
    const wsUrl = `${options.url}?storeId=${encodeURIComponent(options.storeId)}&transport=ws${payloadParam}`

    const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(wsUrl)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )

    const ctx = yield* Layer.build(ProtocolLive)
    const rpcClient = yield* RpcClient.make(SyncWsRpc).pipe(Effect.provide(ctx))

    // Join the room, then subscribe to room snapshots.
    yield* rpcClient['SyncWsRpc.PresenceJoin']({
      storeId: options.storeId,
      clientId: options.clientId,
      name: options.name,
    }).pipe(Effect.catch(() => Effect.void))

    yield* Effect.forkScoped(
      rpcClient['SyncWsRpc.PresenceSnapshots']({ storeId: options.storeId }).pipe(
        Stream.tap((snapshot) => SubscriptionRef.set(snapshotRef, snapshot)),
        Stream.runDrain,
        Effect.interruptible,
        Effect.catch(() => Effect.void),
      ),
    )

    const pushState = (state: PresenceState) =>
      rpcClient['SyncWsRpc.PresenceUpdate']({ storeId: options.storeId, state }).pipe(
        Effect.catch(() => Effect.void),
      )

    // Coalescing throttle: rapid `setState` calls collapse into one send per
    // window (30–50ms is the sweet spot for cursor/drag streams).
    const throttledRef = yield* Ref.make<{
      last: number
      pending: Omit<Partial<PresenceState>, 'clientId' | 'online' | 'updatedAt'>
    }>({ last: 0, pending: {} })

    const flushThrottled = Effect.gen(function* () {
      const { pending } = yield* Ref.get(throttledRef)
      if (Object.keys(pending).length === 0) return
      const state: PresenceState = {
        clientId: options.clientId,
        name: options.name,
        online: true,
        typing: pending.typing,
        cursor: pending.cursor,
        textCursor: pending.textCursor,
        dragging: pending.dragging,
        updatedAt: Date.now(),
      }
      yield* Ref.set(throttledRef, { last: Date.now(), pending: {} })
      yield* pushState(state)
    })

    yield* Effect.forkScoped(
      flushThrottled.pipe(Effect.schedule(Schedule.fixed(options.heartbeatIntervalMs ?? '5 seconds')), Effect.forever),
    )

    const setState = (patch: Omit<Partial<PresenceState>, 'clientId' | 'online' | 'updatedAt'>) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(throttledRef)
        yield* Ref.set(throttledRef, { last: current.last, pending: { ...current.pending, ...patch } })
        const elapsed = Date.now() - current.last
        if (elapsed >= (options.throttleIntervalMs ?? 40)) {
          yield* flushThrottled
        }
      }).pipe(Effect.catch(() => Effect.void))

    return {
      storeId: options.storeId,
      clientId: options.clientId,
      snapshot: snapshotRef,
      snapshots: SubscriptionRef.changes(snapshotRef),
      setState,
      setCursor: (x, y) => setState({ cursor: { x, y } }),
      setTyping: (typing) => setState({ typing }),
      setTextCursor: (offset: number) => setState({ textCursor: offset }),
      setName: (name) => setState({ name }),
      setDragging: (drag) => setState({ dragging: drag }),
      leave: rpcClient['SyncWsRpc.PresenceLeave']({
        storeId: options.storeId,
        clientId: options.clientId,
      }).pipe(Effect.catch(() => Effect.void)),
    }
  })