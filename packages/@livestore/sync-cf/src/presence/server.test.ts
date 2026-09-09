import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Ref, Schema, Stream } from '@livestore/utils/effect'

import type { PresenceSnapshot } from './schema.ts'
import { makePresenceServer } from './server.ts'

const Typing = Schema.Struct({ isTyping: Schema.Boolean })

const baseOptions = {
  channels: { typing: { schema: Typing } },
  memberIdleTtlMs: 60_000,
  sweepIntervalMs: 60_000,
}

const mutation = {
  storeId: 'store-1',
  roomId: 'chat-42',
  channel: 'typing',
  clientId: 'alice',
}

const ids = (snap: { members: ReadonlyArray<{ clientId: string }> }) => snap.members.map((m) => m.clientId)

const current = (stream: Stream.Stream<PresenceSnapshot>) =>
  stream.pipe(Stream.runHead, Effect.map(Option.getOrThrow))

describe('presence server', () => {
  it('runs onJoin before admitting the member', () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<string>>([])
      const server = yield* makePresenceServer('store-1', {
        ...baseOptions,
        onJoin: (event) => Ref.update(seen, (xs) => [...xs, `${event.roomId}:${event.clientId}`]),
      })

      yield* server.join(mutation, {})
      yield* server.update({ ...mutation, state: { isTyping: true } }, {})

      expect(yield* Ref.get(seen)).toEqual(['chat-42:alice'])
      const snap = yield* current(server.hub.snapshots('chat-42', 'typing'))
      expect(ids(snap)).toEqual(['alice'])
    }))

  it('rejects a join when onJoin throws and does not admit the member', () =>
    Effect.gen(function* () {
      const server = yield* makePresenceServer('store-1', {
        ...baseOptions,
        onJoin: () => {
          throw new Error('not a conversation member')
        },
      })

      const result = yield* server.join(mutation, {}).pipe(Effect.result)
      expect(result._tag).toBe('Failure')

      const snap = yield* current(server.hub.snapshots('chat-42', 'typing'))
      expect(ids(snap)).toEqual([])
    }))

  it('authorizes per room so a user can be in one chat and not another', () =>
    Effect.gen(function* () {
      const server = yield* makePresenceServer('store-1', {
        ...baseOptions,
        onJoin: (event) => {
          if (event.roomId !== 'chat-42') throw new Error('forbidden')
        },
      })

      yield* server.join(mutation, {})
      const other = yield* server.join({ ...mutation, roomId: 'chat-99' }, {}).pipe(Effect.result)
      expect(other._tag).toBe('Failure')

      yield* server.update({ ...mutation, state: { isTyping: true } }, {})
      const allowed = yield* current(server.hub.snapshots('chat-42', 'typing'))
      const denied = yield* current(server.hub.snapshots('chat-99', 'typing'))
      expect(ids(allowed)).toEqual(['alice'])
      expect(ids(denied)).toEqual([])
    }))

  it('rejects an update when onUpdate throws and keeps prior state', () =>
    Effect.gen(function* () {
      const server = yield* makePresenceServer('store-1', {
        ...baseOptions,
        onUpdate: (event) => {
          const state = event.state as { isTyping?: boolean } | undefined
          if (state?.isTyping === true) throw new Error('no typing')
        },
      })

      yield* server.join(mutation, {})
      yield* server.update({ ...mutation, state: { isTyping: false } }, {})
      const denied = yield* server.update({ ...mutation, state: { isTyping: true } }, {}).pipe(Effect.result)
      expect(denied._tag).toBe('Failure')

      const snap = yield* current(server.hub.snapshots('chat-42', 'typing'))
      expect(snap.members[0]?.state).toEqual({ isTyping: false })
    }))

  it('forwards payload and headers to hooks so they can re-check auth', () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<unknown>(undefined)
      const server = yield* makePresenceServer('store-1', {
        ...baseOptions,
        onJoin: (_event, context) => Ref.set(seen, context),
      })

      const headers = new Map([['authorization', 'Bearer tok']])
      yield* server.join(mutation, { payload: { authToken: 'tok' }, headers })
      expect(yield* Ref.get(seen)).toEqual({ payload: { authToken: 'tok' }, headers })
    }))

  it('lets onUpdate persist a durable record (log / eventlog side-effect)', () =>
    Effect.gen(function* () {
      const eventlog = yield* Ref.make<Array<{ name: string; roomId: string; isTyping: boolean }>>([])
      const server = yield* makePresenceServer('store-1', {
        ...baseOptions,
        onUpdate: (event) => {
          const state = event.state as { isTyping: boolean }
          return Ref.update(eventlog, (xs) => [
            ...xs,
            { name: 'v1.TypingChanged', roomId: event.roomId, isTyping: state.isTyping },
          ])
        },
      })

      yield* server.join(mutation, {})
      yield* server.update({ ...mutation, state: { isTyping: true } }, {})

      expect(yield* Ref.get(eventlog)).toEqual([
        { name: 'v1.TypingChanged', roomId: 'chat-42', isTyping: true },
      ])
    }))

  it('rate-limits updates before the hook and before fan-out', () =>
    Effect.gen(function* () {
      const hookCount = yield* Ref.make(0)
      const server = yield* makePresenceServer('store-1', {
        ...baseOptions,
        rateLimit: { minIntervalMs: 1_000 },
        onUpdate: () => Ref.update(hookCount, (n) => n + 1),
      })

      yield* server.join(mutation, {})
      yield* server.update({ ...mutation, state: { isTyping: true } }, {})
      const second = yield* server.update({ ...mutation, state: { isTyping: false } }, {}).pipe(Effect.result)
      expect(second._tag).toBe('Failure')
      expect(yield* Ref.get(hookCount)).toBe(1)

      const snap = yield* current(server.hub.snapshots('chat-42', 'typing'))
      expect(snap.members[0]?.state).toEqual({ isTyping: true })
    }))

  it('runs onLeave and evicts the member', () =>
    Effect.gen(function* () {
      const left = yield* Ref.make<Array<string>>([])
      const server = yield* makePresenceServer('store-1', {
        ...baseOptions,
        onLeave: (event) => Ref.update(left, (xs) => [...xs, event.clientId]),
      })

      yield* server.join(mutation, {})
      yield* server.update({ ...mutation, state: { isTyping: true } }, {})
      yield* server.leave(mutation, {})

      expect(yield* Ref.get(left)).toEqual(['alice'])
      const snap = yield* current(server.hub.snapshots('chat-42', 'typing'))
      expect(ids(snap)).toEqual([])
    }))

  it('leaveClient evicts without requiring a channel', () =>
    Effect.gen(function* () {
      const server = yield* makePresenceServer('store-1', baseOptions)
      yield* server.update({ ...mutation, state: { isTyping: true } }, {})
      yield* server.update({ ...mutation, roomId: 'chat-99', state: { isTyping: true } }, {})
      yield* server.leaveClient('alice')

      const a = yield* current(server.hub.snapshots('chat-42', 'typing'))
      const b = yield* current(server.hub.snapshots('chat-99', 'typing'))
      expect(ids(a)).toEqual([])
      expect(ids(b)).toEqual([])
    }))
})
