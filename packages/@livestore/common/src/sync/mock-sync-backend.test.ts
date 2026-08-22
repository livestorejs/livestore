import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Fiber, Option, Stream } from '@livestore/utils/effect'

import { EventSequenceNumber, type LiveStoreEvent } from '../schema/mod.ts'
import { makeMockSyncBackend } from './mock-sync-backend.ts'

Vitest.describe('makeMockSyncBackend', () => {
  Vitest.live('broadcasts live events to every backend connection', () =>
    Effect.gen(function* () {
      const mockBackend = yield* makeMockSyncBackend({ startConnected: true })
      const backendA = yield* mockBackend.makeSyncBackend
      const backendB = yield* mockBackend.makeSyncBackend
      const nextBatch = (backend: typeof backendA) =>
        backend.pull(Option.none(), { live: true }).pipe(
          Stream.filter((item) => item.batch.length > 0),
          Stream.runFirstUnsafe,
        )

      const pullA = yield* nextBatch(backendA).pipe(Effect.forkScoped)
      const pullB = yield* nextBatch(backendB).pipe(Effect.forkScoped)
      const event = makeEvent(1)

      yield* mockBackend.advance(event)

      Vitest.expect((yield* Fiber.join(pullA)).batch.map((item) => item.eventEncoded)).toEqual([event])
      Vitest.expect((yield* Fiber.join(pullB)).batch.map((item) => item.eventEncoded)).toEqual([event])
    }),
  )

  Vitest.live('seeds a new backend connection with existing live events', () =>
    Effect.gen(function* () {
      const mockBackend = yield* makeMockSyncBackend({ startConnected: true })
      const event = makeEvent(1)
      yield* mockBackend.advance(event)

      const backend = yield* mockBackend.makeSyncBackend
      const item = yield* backend.pull(Option.none(), { live: true }).pipe(
        Stream.filter((item) => item.batch.length > 0),
        Stream.runFirstUnsafe,
      )

      Vitest.expect(item.batch.map((entry) => entry.eventEncoded)).toEqual([event])
    }),
  )

  Vitest.live('filters seeded live events against the requested cursor', () =>
    Effect.gen(function* () {
      const mockBackend = yield* makeMockSyncBackend({ startConnected: true })
      const existing = makeEvent(1)
      const next = makeEvent(2)
      yield* mockBackend.advance(existing)

      const backend = yield* mockBackend.makeSyncBackend
      const cursor = Option.some({
        eventSequenceNumber: existing.seqNum,
        metadata: Option.none(),
      })
      const pull = yield* backend.pull(cursor, { live: true }).pipe(
        Stream.filter((item) => item.batch.length > 0),
        Stream.runFirstUnsafe,
        Effect.forkScoped,
      )

      yield* mockBackend.advance(next)

      Vitest.expect((yield* Fiber.join(pull)).batch.map((entry) => entry.eventEncoded)).toEqual([next])
    }),
  )

  Vitest.live('a replacement live pull snapshots pushes whose publication was dropped', () =>
    Effect.gen(function* () {
      const mockBackend = yield* makeMockSyncBackend({ startConnected: true })
      const backend = yield* mockBackend.makeSyncBackend
      const firstPull = yield* backend.pull(Option.none(), { live: true }).pipe(Stream.runDrain, Effect.forkScoped)

      yield* mockBackend.pullRequests.pipe(Stream.runFirstUnsafe)
      yield* mockBackend.dropNextPushPublications(1)
      const event = makeEvent(1)
      yield* backend.push([event])
      yield* Fiber.interrupt(firstPull)

      const replacementItem = yield* backend.pull(Option.none(), { live: true }).pipe(
        Stream.filter((item) => item.batch.length > 0),
        Stream.runFirstUnsafe,
      )

      Vitest.expect(replacementItem.batch.map((entry) => entry.eventEncoded)).toEqual([event])
      Vitest.expect(yield* mockBackend.activePulls.maximum).toEqual(1)
    }),
  )
})

const makeEvent = (seqNum: number): LiveStoreEvent.Global.Encoded => ({
  name: 'v1.TestEvent',
  args: { id: `event-${seqNum}` },
  seqNum: EventSequenceNumber.Global.make(seqNum),
  parentSeqNum: EventSequenceNumber.Global.make(seqNum - 1),
  clientId: 'client-a',
  sessionId: 'session-a',
})
