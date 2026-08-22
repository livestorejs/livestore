import { describe, expect, it } from '@effect/vitest'

import { Effect, Fiber, Ref, Stream } from '@livestore/utils/effect'

import { makePresenceRoom } from './room.ts'

describe('presence room', () => {
  it('starts empty and joins/leaves clients', () =>
    Effect.gen(function* () {
      const room = yield* makePresenceRoom('store-1')

      yield* room.join('alice', 'Alice')
      yield* room.join('bob', undefined)

      const afterJoin = room.snapshot.value
      expect(afterJoin.clients.map((c) => c.clientId).sort()).toEqual(['alice', 'bob'])
      expect(afterJoin.clients.every((c) => c.online === true)).toBe(true)

      yield* room.leave('alice')

      const afterLeave = room.snapshot.value
      expect(afterLeave.clients.map((c) => c.clientId)).toEqual(['bob'])
    }))

  it('preserves existing optional fields when a client rejoins', () =>
    Effect.gen(function* () {
      const room = yield* makePresenceRoom('store-1')

      yield* room.join('alice', 'Alice')
      yield* room.update({ clientId: 'alice', name: 'Alice', online: true, typing: true, updatedAt: 1 })

      yield* room.join('alice', 'Alice')

      const alice = room.snapshot.value.clients.find((c) => c.clientId === 'alice')
      expect(alice?.typing).toBe(true)
    }))

  it('updates typing and cursor state', () =>
    Effect.gen(function* () {
      const room = yield* makePresenceRoom('store-1')
      yield* room.join('alice', 'Alice')

      yield* room.update({
        clientId: 'alice',
        name: 'Alice',
        online: true,
        typing: true,
        cursor: { x: 10, y: 20 },
        updatedAt: 123,
      })

      const alice = room.snapshot.value.clients.find((c) => c.clientId === 'alice')
      expect(alice?.typing).toBe(true)
      expect(alice?.cursor).toEqual({ x: 10, y: 20 })
    }))

  it('emits a snapshot per mutation on the stream', () =>
    Effect.gen(function* () {
      const room = yield* makePresenceRoom('store-1')
      const snapshotsRef = yield* Ref.make<Array<string>>([])

      const fiber = yield* Effect.forkScoped(
        room.snapshots.pipe(
          Stream.tap((s) => Ref.update(snapshotsRef, (xs) => [...xs, s.clients.map((c) => c.clientId).join(',')])),
          Stream.runDrain,
        ),
      )

      yield* room.join('alice', 'Alice')
      yield* room.join('bob', 'Bob')
      yield* room.leave('alice')

      const recorded = yield* Ref.get(snapshotsRef)
      expect(recorded).toEqual(['alice', 'alice,bob', 'bob'])

      yield* Fiber.interrupt(fiber)
    }))
})