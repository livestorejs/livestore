import { Effect, Ref, Result, Schedule, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { PresenceSnapshot } from './schema.ts'

/**
 * A named presence channel definition, declared once on the server (the party)
 * and mirrored by clients for end-to-end type safety. `schema` validates every
 * state patch a client may broadcast on this channel.
 */
export interface PresenceChannelDef {
  /** Validates/decodes each state patch merged onto a member. */
  readonly schema: Parameters<typeof Schema.decodeUnknownSync>[0]
}

export interface PresenceRoomOptions {
  /**
   * Members whose last update is older than this are considered gone (ms).
   *
   * Clients should heartbeat at well under half of this so active members are
   * never pruned.
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

export interface PresenceRoom {
  readonly storeId: string
  join: (
    channel: string,
    clientId: string,
    name: string | undefined,
  ) => Effect.Effect<void, PresenceChannelError>
  /**
   * Merges a validated JSON patch into the member's state on `channel`.
   * Fails (typed `PresenceChannelError`) for unknown channels or invalid patches.
   */
  update: (channel: string, clientId: string, patch: unknown) => Effect.Effect<void, PresenceChannelError>
  leave: (channel: string, clientId: string) => Effect.Effect<void>
  /** Live stream of channel snapshots; emits the current value on subscribe. */
  snapshots: (channel: string) => Stream.Stream<PresenceSnapshot, never>
}

export class PresenceChannelError extends Schema.TaggedError<PresenceChannelError>(
  '@livestore/presence/PresenceChannelError',
)('PresenceChannelError', { message: Schema.String }) {}

const makeSnapshot = (
  storeId: string,
  channel: string,
  members: ReadonlyMap<string, { clientId: string; name?: string; updatedAt: number; state: unknown }>,
  ttlMs: number,
): PresenceSnapshot => ({
  storeId,
  channel,
  members: [...members.values()]
    .filter((m) => Date.now() - m.updatedAt < ttlMs && m.state !== undefined)
    .toSorted((a, b) => a.clientId.localeCompare(b.clientId))
    .map(({ clientId, name, updatedAt, state }) => ({ clientId, name, online: true, updatedAt, state: state as any })),
})

/**
 * Channel-aware presence room for one `storeId`.
 *
 * Channels are declared once by the party (`channels` map of name → schema def)
 * and mirrored by clients for typed updates. Every mutation republishes the
 * affected channel's snapshot; an idle-TTL sweeper prunes silent members so
 * closed tabs disappear even without a clean leave.
 */
export const makePresenceRoom = (
  storeId: string,
  options: PresenceRoomOptions & {
    channels: Record<string, PresenceChannelDef>
  },
): Effect.Effect<PresenceRoom, never, never> =>
  Effect.gen(function* () {
    const memberIdleTtlMs = options.memberIdleTtlMs ?? 15_000
    const sweepIntervalMs = options.sweepIntervalMs ?? 5_000

    // channel → clientId → member
    const membersRef = yield* Ref.make<ReadonlyMap<string, Map<string, {
      clientId: string
      name?: string
      updatedAt: number
      state: unknown
    }>>>(new Map())

    const snapshotRefs = yield* Ref.make(new Map<string, SubscriptionRef.SubscriptionRef<PresenceSnapshot>>())

    const snapshotFor = (channel: string, members: ReadonlyMap<string, {
      clientId: string
      name?: string
      updatedAt: number
      state: unknown
    }>): PresenceSnapshot => makeSnapshot(storeId, channel, members, memberIdleTtlMs)

    const getSnapshotRef = Effect.fnUntraced(function* (channel: string) {
      const existing = (yield* Ref.get(snapshotRefs)).get(channel)
      if (existing !== undefined) return existing
      const ref = yield* SubscriptionRef.make<PresenceSnapshot>(
        snapshotFor(channel, (yield* Ref.get(membersRef)).get(channel) ?? new Map()),
      )
      yield* Ref.update(snapshotRefs, (map) => new Map(map).set(channel, ref))
      return ref
    })

    const publish = Effect.fnUntraced(function* (channel: string) {
      const ref = yield* getSnapshotRef(channel)
      const members = (yield* Ref.get(membersRef)).get(channel) ?? new Map()
      // Prune expired members while publishing.
      const now = Date.now()
      let changed = false
      const pruned = new Map(members)
      for (const [id, member] of pruned) {
        if (now - member.updatedAt >= memberIdleTtlMs) {
          pruned.delete(id)
          changed = true
        }
      }
      if (changed === true) {
        yield* Ref.update(membersRef, (channels) => new Map(channels).set(channel, pruned))
      }
      yield* SubscriptionRef.set(ref, makeSnapshot(storeId, channel, pruned, memberIdleTtlMs))
    })

    // Periodic sweep across all live channels so silent disconnects expire
    // without further room traffic. Detached: the room lives for the process/DO
    // lifetime; members are pruned by idle TTL, not scope teardown.
    yield* Effect.forkDetach(
      Effect.gen(function* () {
        const channels = yield* Ref.get(snapshotRefs)
        for (const channel of channels.keys()) {
          yield* publish(channel)
        }
      }).pipe(Effect.schedule(Schedule.fixed(sweepIntervalMs)), Effect.forever),
    )

    return {
      storeId,

      join: (channel, clientId, name) =>
        Effect.gen(function* () {
          if (options.channels[channel] === undefined) {
            return yield* new PresenceChannelError({ message: `Unknown presence channel: ${channel}` })
          }
          yield* Ref.update(membersRef, (channels) => {
            const members = new Map(channels.get(channel) ?? new Map())
            const existing = members.get(clientId)
            members.set(clientId, {
              clientId,
              name: name ?? existing?.name,
              updatedAt: Date.now(),
              state: existing?.state,
            })
            return new Map(channels).set(channel, members)
          })
          yield* publish(channel)
        }),

      update: (channel, clientId, patch) =>
        Effect.gen(function* () {
          const def = options.channels[channel]
          if (def === undefined) {
            return yield* new PresenceChannelError({ message: `Unknown presence channel: ${channel}` })
          }
          yield* Ref.update(membersRef, (channels) => {
            const members = new Map(channels.get(channel) ?? new Map())
            const existing = members.get(clientId)
            if (existing === undefined) return channels
            // REPLACE state (not merge): the client sends its full accumulated
            // state, so absent keys are truly absent (e.g. cleared drag).
            members.set(clientId, { ...existing, updatedAt: Date.now(), state: patch as Record<string, unknown> })
            return new Map(channels).set(channel, members)
          })
          yield* publish(channel)
        }),

      leave: (channel, clientId) =>
        Effect.gen(function* () {
          yield* Ref.update(membersRef, (channels) => {
            const members = new Map(channels.get(channel) ?? new Map())
            members.delete(clientId)
            return new Map(channels).set(channel, members)
          })
          yield* publish(channel)
        }),

      snapshots: (channel) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const ref = yield* getSnapshotRef(channel)
            return SubscriptionRef.changes(ref)
          }),
        ),
    }
  })