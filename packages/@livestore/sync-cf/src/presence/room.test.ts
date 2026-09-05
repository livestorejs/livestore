import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Option, Ref, Schema, Stream } from '@livestore/utils/effect'

import { makePresenceHub } from './room.ts'
import type { PresenceSnapshot } from './schema.ts'

const Typing = Schema.Struct({ isTyping: Schema.Boolean })
const Cursor = Schema.Struct({ x: Schema.Finite, y: Schema.Finite })

const makeHub = () =>
  makePresenceHub('store-1', {
    channels: { typing: { schema: Typing }, cursor: { schema: Cursor } },
    memberIdleTtlMs: 60_000,
    sweepIntervalMs: 60_000,
  })

const ids = (snap: { members: ReadonlyArray<{ clientId: string }> }) => snap.members.map((m) => m.clientId)

const current = (stream: Stream.Stream<PresenceSnapshot>) =>
  stream.pipe(Stream.runHead, Effect.map(Option.getOrThrow))

describe('presence hub', () => {
  it('isolates members by room', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      yield* hub.join('chat-alice-bob', 'typing', 'alice', 'Alice')
      yield* hub.update('chat-alice-bob', 'typing', 'alice', { isTyping: true })
      yield* hub.join('chat-carol-dave', 'typing', 'carol', 'Carol')
      yield* hub.update('chat-carol-dave', 'typing', 'carol', { isTyping: true })

      const aliceRoom = yield* current(hub.snapshots('chat-alice-bob', 'typing'))
      const carolRoom = yield* current(hub.snapshots('chat-carol-dave', 'typing'))

      expect(ids(aliceRoom)).toEqual(['alice'])
      expect(ids(carolRoom)).toEqual(['carol'])
    }))

  it('lets one client join many rooms without leaking state', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      yield* hub.join('chat-1', 'typing', 'alice', 'Alice')
      yield* hub.update('chat-1', 'typing', 'alice', { isTyping: true })
      yield* hub.join('chat-2', 'typing', 'alice', 'Alice')
      yield* hub.update('chat-2', 'typing', 'alice', { isTyping: false })

      const room1 = yield* current(hub.snapshots('chat-1', 'typing'))
      const room2 = yield* current(hub.snapshots('chat-2', 'typing'))

      expect(room1.members[0]?.state).toEqual({ isTyping: true })
      expect(room2.members[0]?.state).toEqual({ isTyping: false })
    }))

  it('isolates channels inside a room', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      yield* hub.join('board', 'typing', 'alice', 'Alice')
      yield* hub.update('board', 'typing', 'alice', { isTyping: true })
      yield* hub.join('board', 'cursor', 'alice', 'Alice')
      yield* hub.update('board', 'cursor', 'alice', { x: 1, y: 2 })

      const typing = yield* current(hub.snapshots('board', 'typing'))
      const cursor = yield* current(hub.snapshots('board', 'cursor'))

      expect(typing.members[0]?.state).toEqual({ isTyping: true })
      expect(cursor.members[0]?.state).toEqual({ x: 1, y: 2 })
    }))

  it('rejects unknown channels', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const result = yield* hub.join('board', 'chat', 'alice', 'Alice').pipe(Effect.result)
      expect(result._tag).toBe('Failure')
    }))

  it('rejects payloads that fail the channel schema', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      yield* hub.join('board', 'typing', 'alice', 'Alice')
      const result = yield* hub.update('board', 'typing', 'alice', { isTyping: 'yes' }).pipe(Effect.result)
      expect(result._tag).toBe('Failure')

      const snap = yield* current(hub.snapshots('board', 'typing'))
      expect(snap.members).toEqual([])
    }))

  it('creates a member on update if join was missed', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      yield* hub.update('board', 'cursor', 'alice', { x: 4, y: 8 })
      const snap = yield* current(hub.snapshots('board', 'cursor'))
      expect(ids(snap)).toEqual(['alice'])
      expect(snap.members[0]?.state).toEqual({ x: 4, y: 8 })
    }))

  it('leaveClient evicts the client from every room', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      yield* hub.update('chat-1', 'typing', 'alice', { isTyping: true })
      yield* hub.update('chat-2', 'typing', 'alice', { isTyping: true })
      yield* hub.update('chat-1', 'typing', 'bob', { isTyping: false })
      yield* hub.leaveClient('alice')

      const room1 = yield* current(hub.snapshots('chat-1', 'typing'))
      const room2 = yield* current(hub.snapshots('chat-2', 'typing'))
      expect(ids(room1)).toEqual(['bob'])
      expect(ids(room2)).toEqual([])
    }))

  it('preserves state across rejoin', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      yield* hub.join('board', 'typing', 'alice', 'Alice')
      yield* hub.update('board', 'typing', 'alice', { isTyping: true })
      yield* hub.join('board', 'typing', 'alice', 'Alice')
      const snap = yield* current(hub.snapshots('board', 'typing'))
      expect(snap.members[0]?.state).toEqual({ isTyping: true })
    }))

  it('emits a snapshot per mutation', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const recorded = yield* Ref.make<Array<string>>([])

      const fiber = yield* Effect.forkScoped(
        hub.snapshots('board', 'typing').pipe(
          Stream.tap((s) => Ref.update(recorded, (xs) => [...xs, ids(s).join(',')])),
          Stream.runDrain,
        ),
      )

      yield* hub.update('board', 'typing', 'alice', { isTyping: true })
      yield* hub.update('board', 'typing', 'bob', { isTyping: false })
      yield* hub.leave('board', 'typing', 'alice')

      const values = yield* Ref.get(recorded)
      expect(values.filter((v) => v !== '')).toEqual(['alice', 'alice,bob', 'bob'])

      yield* Fiber.interrupt(fiber)
    }))
})
