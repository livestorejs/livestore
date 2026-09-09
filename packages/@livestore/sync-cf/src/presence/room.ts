import { omitUndefineds } from '@livestore/utils'
import { Effect, Ref, Result, Schedule, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { PresenceSnapshot } from './schema.ts'

/**
 * A named presence channel definition, declared once on the Durable Object
 * and mirrored by clients for end-to-end type safety. `schema` validates every
 * state payload a client may broadcast on this channel.
 */
export interface PresenceChannelDef {
  readonly schema: Parameters<typeof Schema.decodeUnknownSync>[0]
}

export interface PresenceRoomOptions {
  /**
   * Members whose last update is older than this are considered gone (ms).
   * Clients should heartbeat at well under half of this so active members are
   * never pruned.
   *
   * @default 15_000
   */
  readonly memberIdleTtlMs?: number
  /**
   * How often the hub sweeps for expired members (ms).
   *
   * @default 5_000
   */
  readonly sweepIntervalMs?: number
}

export class PresenceChannelError extends Schema.TaggedError<PresenceChannelError>(
  '@livestore/presence/PresenceChannelError',
)('PresenceChannelError', { message: Schema.String }) {}

type Member = {
  clientId: string
  name?: string
  updatedAt: number
  state: unknown
}

/** roomId → channel → clientId → member */
type RoomTree = ReadonlyMap<string, ReadonlyMap<string, Map<string, Member>>>

export interface PresenceHub {
  readonly storeId: string
  join: (
    roomId: string,
    channel: string,
    clientId: string,
    name: string | undefined,
  ) => Effect.Effect<void, PresenceChannelError>
  /**
   * Replaces the member's channel state with a schema-decoded payload.
   * Unknown members are created (hibernation / missed join).
   */
  update: (roomId: string, channel: string, clientId: string, patch: unknown) => Effect.Effect<void, PresenceChannelError>
  leave: (roomId: string, channel: string, clientId: string) => Effect.Effect<void>
  /** Evict this client from every room and channel (socket close). */
  leaveClient: (clientId: string) => Effect.Effect<void>
  snapshots: (roomId: string, channel: string) => Stream.Stream<PresenceSnapshot>
}

const snapshotKey = (roomId: string, channel: string) => `${roomId}\0${channel}`

const makeSnapshot = (
  storeId: string,
  roomId: string,
  channel: string,
  members: ReadonlyMap<string, Member>,
  ttlMs: number,
): PresenceSnapshot => ({
  storeId,
  roomId,
  channel,
  members: [...members.values()]
    .filter((m) => Date.now() - m.updatedAt < ttlMs && m.state !== undefined)
    .toSorted((a, b) => a.clientId.localeCompare(b.clientId))
    .map(({ clientId, name, updatedAt, state }) => ({
      clientId,
      name,
      online: true,
      updatedAt,
      state: state as PresenceSnapshot['members'][number]['state'],
    })),
})

/**
 * In-memory presence hub for one store (one Durable Object).
 *
 * Isolation is by `roomId`: a typing indicator in `chat:alice-bob` is never
 * visible to members of `chat:carol-dave`. Channels are typed topics inside
 * a room (cursor, typing, …), declared once via `channels`.
 */
export const makePresenceHub = (
  storeId: string,
  options: PresenceRoomOptions & {
    channels: Record<string, PresenceChannelDef>
  },
): Effect.Effect<PresenceHub> =>
  Effect.gen(function* () {
    const memberIdleTtlMs = options.memberIdleTtlMs ?? 15_000
    const sweepIntervalMs = options.sweepIntervalMs ?? 5_000

    const roomsRef = yield* Ref.make<RoomTree>(new Map())
    const snapshotRefs = yield* Ref.make(
      new Map<string, SubscriptionRef.SubscriptionRef<PresenceSnapshot>>(),
    )

    const membersOf = (rooms: RoomTree, roomId: string, channel: string): Map<string, Member> =>
      rooms.get(roomId)?.get(channel) ?? new Map()

    const getSnapshotRef = Effect.fnUntraced(function* (roomId: string, channel: string) {
      const key = snapshotKey(roomId, channel)
      const existing = (yield* Ref.get(snapshotRefs)).get(key)
      if (existing !== undefined) return existing
      const ref = yield* SubscriptionRef.make<PresenceSnapshot>(
        makeSnapshot(storeId, roomId, channel, membersOf(yield* Ref.get(roomsRef), roomId, channel), memberIdleTtlMs),
      )
      yield* Ref.update(snapshotRefs, (map) => new Map(map).set(key, ref))
      return ref
    })

    const publish = Effect.fnUntraced(function* (roomId: string, channel: string) {
      const ref = yield* getSnapshotRef(roomId, channel)
      const now = Date.now()
      yield* Ref.update(roomsRef, (rooms) => {
        const members = new Map(membersOf(rooms, roomId, channel))
        for (const [id, member] of members) {
          if (now - member.updatedAt >= memberIdleTtlMs) members.delete(id)
        }
        return setMembers(rooms, roomId, channel, members)
      })
      const members = membersOf(yield* Ref.get(roomsRef), roomId, channel)
      yield* SubscriptionRef.set(ref, makeSnapshot(storeId, roomId, channel, members, memberIdleTtlMs))
    })

    // One sweeper for every room. Detached: the hub lives for the DO lifetime.
    yield* Effect.forkDetach(
      Effect.gen(function* () {
        const refs = yield* Ref.get(snapshotRefs)
        for (const key of refs.keys()) {
          const sep = key.indexOf('\0')
          yield* publish(key.slice(0, sep), key.slice(sep + 1))
        }
      }).pipe(Effect.schedule(Schedule.fixed(sweepIntervalMs)), Effect.forever),
    )

    const requireChannel = (channel: string) => {
      const def = options.channels[channel]
      if (def === undefined) {
        return Effect.fail(new PresenceChannelError({ message: `Unknown presence channel: ${channel}` }))
      }
      return Effect.succeed(def)
    }

    return {
      storeId,

      join: (roomId, channel, clientId, name) =>
        Effect.gen(function* () {
          yield* requireChannel(channel)
          yield* Ref.update(roomsRef, (rooms) => {
            const members = new Map(membersOf(rooms, roomId, channel))
            const existing = members.get(clientId)
            members.set(
              clientId,
              omitUndefineds({
                clientId,
                name: name ?? existing?.name,
                updatedAt: Date.now(),
                state: existing?.state,
              }),
            )
            return setMembers(rooms, roomId, channel, members)
          })
          yield* publish(roomId, channel)
        }),

      update: (roomId, channel, clientId, patch) =>
        Effect.gen(function* () {
          const def = yield* requireChannel(channel)
          const decoded = Schema.decodeUnknownResult(def.schema)(patch)
          if (Result.isFailure(decoded)) {
            return yield* new PresenceChannelError({
              message: `Invalid presence state for channel ${channel}`,
            })
          }
          yield* Ref.update(roomsRef, (rooms) => {
            const members = new Map(membersOf(rooms, roomId, channel))
            const existing = members.get(clientId)
            members.set(
              clientId,
              omitUndefineds({
                clientId,
                name: existing?.name,
                updatedAt: Date.now(),
                state: decoded.success,
              }),
            )
            return setMembers(rooms, roomId, channel, members)
          })
          yield* publish(roomId, channel)
        }),

      leave: (roomId, channel, clientId) =>
        Effect.gen(function* () {
          yield* Ref.update(roomsRef, (rooms) => {
            const members = new Map(membersOf(rooms, roomId, channel))
            members.delete(clientId)
            return setMembers(rooms, roomId, channel, members)
          })
          yield* publish(roomId, channel)
        }),

      leaveClient: (clientId) =>
        Effect.gen(function* () {
          const rooms = yield* Ref.get(roomsRef)
          const touched: Array<readonly [string, string]> = []
          yield* Ref.update(roomsRef, (current) => {
            let next = current
            for (const [roomId, channels] of current) {
              for (const [channel, members] of channels) {
                if (members.has(clientId) === false) continue
                const copy = new Map(members)
                copy.delete(clientId)
                next = setMembers(next, roomId, channel, copy)
                touched.push([roomId, channel])
              }
            }
            return next
          })
          yield* Effect.forEach(touched, ([roomId, channel]) => publish(roomId, channel))
        }),

      snapshots: (roomId, channel) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const ref = yield* getSnapshotRef(roomId, channel)
            return SubscriptionRef.changes(ref)
          }),
        ),
    }
  })

const setMembers = (
  rooms: RoomTree,
  roomId: string,
  channel: string,
  members: Map<string, Member>,
): RoomTree => {
  const channels = new Map(rooms.get(roomId) ?? new Map())
  if (members.size === 0) {
    channels.delete(channel)
  } else {
    channels.set(channel, members)
  }
  const next = new Map(rooms)
  if (channels.size === 0) {
    next.delete(roomId)
  } else {
    next.set(roomId, channels)
  }
  return next
}
