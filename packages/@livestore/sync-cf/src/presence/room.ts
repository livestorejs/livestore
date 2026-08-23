import { Effect, Ref, Schedule, Scope, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { PresenceSnapshot, PresenceState } from './schema.ts'

/**
 * Transport-agnostic presence room: one per `storeId`, holding the ephemeral
 * in-memory state of every connected client.
 *
 * Nothing here touches the eventlog, SQLite, or the sync backend. A client
 * joins with a `clientId`, updates its `PresenceState`, and leaves; on every
 * change the room emits the full `PresenceSnapshot` for the room.
 */
export interface PresenceRoom {
  readonly storeId: string
  /** Current room snapshot, updated on every membership/state change. */
  readonly snapshot: SubscriptionRef.SubscriptionRef<PresenceSnapshot>
  /** Stream of room snapshots, emitting the initial value first. */
  readonly snapshots: Stream.Stream<PresenceSnapshot, never>
  join: (clientId: string, name: string | undefined) => Effect.Effect<void>
  update: (state: PresenceState) => Effect.Effect<void>
  leave: (clientId: string) => Effect.Effect<void>
}

export interface PresenceRoomOptions {
  /**
   * Members whose last update is older than this are considered gone (ms).
   *
   * Clients should emit a heartbeat at well under half this interval so active
   * clients are never pruned.
   *
   * @default 15_000
   */
  readonly memberIdleTtlMs?: number
  /**
   * How often the room sweeps for expired members (ms).
   *
   * @default 5_000
   */
  readonly sweepIntervalMs?: number
}

const snapshot = (
  storeId: string,
  members: ReadonlyMap<string, PresenceState>,
  memberIdleTtlMs: number,
): PresenceSnapshot => ({
  storeId,
  clients: [...members.values()]
    .filter((m) => Date.now() - m.updatedAt < memberIdleTtlMs)
    .toSorted((a, b) => a.clientId.localeCompare(b.clientId)),
})

/**
 * Creates a presence room for a single `storeId`.
 *
 * Members are keyed by `clientId` in an immutable `Ref`; every mutation
 * rebuilds the map and publishes a fresh `PresenceSnapshot` to the shared
 * `SubscriptionRef`. Members whose last update exceeds `memberIdleTtlMs` are
 * pruned, so a closed tab (whose socket may not deliver a clean `leave`)
 * disappears after the TTL instead of lingering forever.
 *
 * All mutations serialize through the `Ref`, so concurrent
 * joins/updates/leaves cannot interleave into a torn snapshot.
 *
 * Requires a `Scope`: a periodic sweeper runs until that scope closes.
 */
export const makePresenceRoom = (
  storeId: string,
  options: PresenceRoomOptions = {},
): Effect.Effect<PresenceRoom, never, Scope.Scope> =>
  Effect.gen(function* () {
    const memberIdleTtlMs = options.memberIdleTtlMs ?? 15_000
    const sweepIntervalMs = options.sweepIntervalMs ?? 5_000
    const membersRef = yield* Ref.make<ReadonlyMap<string, PresenceState>>(new Map())
    const snapshotRef = yield* SubscriptionRef.make<PresenceSnapshot>(
      snapshot(storeId, yield* Ref.get(membersRef), memberIdleTtlMs),
    )

    // Prune expired members and republish when membership shrank. A periodic
    // sweep covers silent disconnects even without further room mutations.
    const sweepAndEmit = Effect.gen(function* () {
      const before = yield* Ref.get(membersRef)
      const now = Date.now()
      const next = new Map(before)
      for (const [id, member] of next) {
        if (now - member.updatedAt >= memberIdleTtlMs) next.delete(id)
      }
      if (next.size !== before.size) {
        yield* Ref.set(membersRef, next)
      }
      const current = yield* Ref.get(membersRef)
      yield* SubscriptionRef.set(snapshotRef, snapshot(storeId, current, memberIdleTtlMs))
    })

    yield* Effect.forkScoped(
      sweepAndEmit.pipe(Effect.schedule(Schedule.fixed(sweepIntervalMs)), Effect.forever),
    )

    return {
      storeId,
      snapshot: snapshotRef,
      snapshots: SubscriptionRef.changes(snapshotRef),
      join: (clientId, name) =>
        Ref.update(membersRef, (members) => {
          const existing = members.get(clientId)
          const state: PresenceState = {
            clientId,
            name: name ?? existing?.name,
            online: true,
            typing: existing?.typing,
            cursor: existing?.cursor,
            textCursor: existing?.textCursor,
            dragging: existing?.dragging,
            updatedAt: Date.now(),
          }
          const next = new Map(members)
          next.set(clientId, state)
          return next
        }).pipe(Effect.andThen(sweepAndEmit)),
      update: (state) =>
        Ref.update(membersRef, (members) => {
          const next = new Map(members)
          next.set(state.clientId, { ...state, online: true })
          return next
        }).pipe(Effect.andThen(sweepAndEmit)),
      leave: (clientId) =>
        Ref.update(membersRef, (members) => {
          const next = new Map(members)
          next.delete(clientId)
          return next
        }).pipe(Effect.andThen(sweepAndEmit)),
    }
  })