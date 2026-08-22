import { describe, expect, it } from '@effect/vitest'

import { Effect } from '@livestore/utils/effect'

import { makePresenceClient } from './client.ts'
import { makeNodePresenceServerSelfContained } from './node-server.ts'

describe('presence client/server over WebSocket', () => {
  it('two clients in the same room see each other (multitab)', () =>
    Effect.gen(function* () {
      const { port } = yield* makeNodePresenceServerSelfContained('store-1')
      const url = `ws://127.0.0.1:${port}`

      const clientA = yield* makePresenceClient({ url, storeId: 'store-1', clientId: 'alice', name: 'Alice' })
      const clientB = yield* makePresenceClient({ url, storeId: 'store-1', clientId: 'bob', name: 'Bob' })

      // Client A joins first.
      yield* Effect.sleep('100 millis')

      const snapshotForA = clientA.snapshot.value
      expect(snapshotForA.clients.map((c) => c.clientId).sort()).toEqual(['alice'])

      // Client B joins; A should observe B.
      yield* Effect.sleep('100 millis')
      const afterBJoins = clientA.snapshot.value
      expect(afterBJoins.clients.map((c) => c.clientId).sort()).toEqual(['alice', 'bob'])
    }))

  it('cursor and typing updates broadcast to peers', () =>
    Effect.gen(function* () {
      const { port } = yield* makeNodePresenceServerSelfContained('store-1')
      const url = `ws://127.0.0.1:${port}`

      const clientA = yield* makePresenceClient({ url, storeId: 'store-1', clientId: 'alice', name: 'Alice' })
      const clientB = yield* makePresenceClient({ url, storeId: 'store-1', clientId: 'bob', name: 'Bob' })

      yield* Effect.sleep('100 millis')

      yield* clientA.setCursor(42, 77)
      yield* clientB.setTyping(true)

      yield* Effect.sleep('200 millis')

      const bob = clientA.snapshot.value.clients.find((c) => c.clientId === 'bob')
      expect(bob?.typing).toBe(true)

      const alice = clientB.snapshot.value.clients.find((c) => c.clientId === 'alice')
      expect(alice?.cursor).toEqual({ x: 42, y: 77 })
    }))

  it('leaving removes a client from peers', () =>
    Effect.gen(function* () {
      const { port } = yield* makeNodePresenceServerSelfContained('store-1')
      const url = `ws://127.0.0.1:${port}`

      const clientA = yield* makePresenceClient({ url, storeId: 'store-1', clientId: 'alice', name: 'Alice' })
      const clientB = yield* makePresenceClient({ url, storeId: 'store-1', clientId: 'bob', name: 'Bob' })

      yield* Effect.sleep('100 millis')

      yield* clientB.leave
      yield* Effect.sleep('100 millis')

      const snapshotForA = clientA.snapshot.value
      expect(snapshotForA.clients.map((c) => c.clientId)).toEqual(['alice'])
    }))
})