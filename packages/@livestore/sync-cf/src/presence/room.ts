import { Effect, Ref, Stream, SubscriptionRef } from '@livestore/utils/effect'

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

const snapshot = (storeId: string, members: ReadonlyMap<string, PresenceState>): PresenceSnapshot => ({
  storeId,
  clients: [...members.values()].toSorted((a, b) => a.clientId.localeCompare(b.clientId)),
})

/**
 * Creates a presence room for a single `storeId`.
 *
 * Members are keyed by `clientId` in an immutable `Ref`; every mutation
 * rebuilds the map and publishes a fresh `PresenceSnapshot` to the shared
 * `SubscriptionRef`. All mutations serialize through the `Ref`, so concurrent
 * joins/updates/leaves cannot interleave into a torn snapshot.
 */
export const makePresenceRoom = (
  storeId: string,
): Effect.Effect<PresenceRoom, never, never> =>
  Effect.gen(function* () {
    const membersRef = yield* Ref.make<ReadonlyMap<string, PresenceState>>(new Map())
    const snapshotRef = yield* SubscriptionRef.make<PresenceSnapshot>(
      snapshot(storeId, yield* Ref.get(membersRef)),
    )

    const emit = Effect.gen(function* () {
      yield* SubscriptionRef.set(snapshotRef, snapshot(storeId, yield* Ref.get(membersRef)))
    })

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
        }).pipe(Effect.andThen(emit)),
      update: (state) =>
        Ref.update(membersRef, (members) => {
          const next = new Map(members)
          next.set(state.clientId, { ...state, online: true })
          return next
        }).pipe(Effect.andThen(emit)),
      leave: (clientId) =>
        Ref.update(membersRef, (members) => {
          const next = new Map(members)
          next.delete(clientId)
          return next
        }).pipe(Effect.andThen(emit)),
    }
  })