import type { BootStatus } from '@livestore/common'
import { SyncState } from '@livestore/common'
import { Eventlog, makeMaterializeEvent, recreateDb, streamEventsWithSyncState } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Chunk, Effect, Fiber, Option, Queue, Ref, Schema, Stream, Subscribable } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { events as fixtureEvents, schema as fixtureSchema } from './fixture.ts'

const withNodeFs = <R, E, A>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer))

/**
 * Minimal runtime for exercising `streamEventsWithSyncState` in isolation.
 *
 * We intentionally avoid the heavier `withTestCtx` harness used by
 * `LeaderSyncProcessor.test.ts`. That helper spins up the entire leader layer
 * (mock sync backend, shutdown plumbing, queues, etc.) because it verifies the
 * processor end-to-end. Here we only need three pieces:
 *   1. sqlite eventlog
 *   2. sqlite state DB (for the session changeset join)
 *   3. a controllable `syncState` subscription
 * Pulling those together directly keeps the unit test fast and focused while
 * still relying on the real persistence layer.
 */
const makeTestEnvironment = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })

  const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
  const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })

  yield* Eventlog.initEventlogDb(dbEventlog)

  const bootStatusQueue = yield* Queue.unbounded<BootStatus>()
  const materializeEvent = yield* makeMaterializeEvent({ schema: fixtureSchema, dbState, dbEventlog })
  yield* recreateDb({ dbState, dbEventlog, schema: fixtureSchema, bootStatusQueue, materializeEvent })
  yield* Queue.shutdown(bootStatusQueue)

  const initialSyncState = SyncState.SyncState.make({
    pending: [],
    upstreamHead: EventSequenceNumber.ROOT,
    localHead: EventSequenceNumber.ROOT,
  })

  const syncStateRef = yield* Ref.make(initialSyncState)
  const headQueue = yield* Queue.unbounded<SyncState.SyncState>()

  const syncState = Subscribable.make({
    get: Ref.get(syncStateRef),
    changes: Stream.fromQueue(headQueue),
  })

  const advanceHead = (head: EventSequenceNumber.EventSequenceNumber) =>
    Effect.gen(function* () {
      const nextState = SyncState.SyncState.make({
        pending: [],
        upstreamHead: head,
        localHead: head,
      })
      yield* Ref.set(syncStateRef, nextState)
      yield* Queue.offer(headQueue, nextState)
    })

  const closeHeads = Queue.shutdown(headQueue)

  return { dbEventlog, dbState, syncState, advanceHead, closeHeads }
})

const toEncodedWithMeta = (event: LiveStoreEvent.AnyEncodedGlobal): LiveStoreEvent.EncodedWithMeta =>
  LiveStoreEvent.EncodedWithMeta.fromGlobal(event, {
    syncMetadata: Option.none(),
    materializerHashLeader: Option.none(),
    materializerHashSession: Option.none(),
  })

const eventHashes = {
  todoCreated: Schema.hash(fixtureEvents.todoCreated.schema),
  todoCompleted: Schema.hash(fixtureEvents.todoCompleted.schema),
  todoDeletedNonPure: Schema.hash(fixtureEvents.todoDeletedNonPure.schema),
} as const

const insertEvents = (dbEventlog: unknown, events: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>) =>
  Effect.forEach(events, (event) =>
    Eventlog.insertIntoEventlog(
      event,
      dbEventlog as any,
      eventHashes[event.name as keyof typeof eventHashes],
      event.clientId,
      event.sessionId,
    ),
  )

Vitest.describe.concurrent('streamEventsWithSyncState', () => {
  Vitest.scopedLive('emits events as upstream head advances', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const eventHash = Schema.hash(fixtureEvents.todoCreated.schema)

        const eventFactory = EventFactory.makeFactory(fixtureEvents)({
          client: EventFactory.clientIdentity('client-1', 'session-1'),
        })

        const event1 = toEncodedWithMeta(eventFactory.todoCreated.next({ id: '1', text: 'first', completed: false }))
        const event2 = toEncodedWithMeta(eventFactory.todoCreated.next({ id: '2', text: 'second', completed: false }))

        yield* Eventlog.insertIntoEventlog(event1, dbEventlog, eventHash, event1.clientId, event1.sessionId)
        yield* Eventlog.insertIntoEventlog(event2, dbEventlog, eventHash, event2.clientId, event2.sessionId)

        const stream = streamEventsWithSyncState({
          dbEventlog,
          dbState,
          syncState,
          options: {
            since: EventSequenceNumber.ROOT,
          },
        })

        const collectFiber = yield* stream.pipe(Stream.take(2), Stream.runCollect).pipe(Effect.forkScoped)

        yield* advanceHead(event2.seqNum)

        const collected = yield* collectFiber.pipe(Fiber.join)
        const emitted = Chunk.toReadonlyArray(collected)

        expect(emitted.map((event) => event.name)).toEqual([
          fixtureEvents.todoCreated.name,
          fixtureEvents.todoCreated.name,
        ])
        expect(emitted.map((event) => event.args)).toEqual([
          { id: '1', text: 'first', completed: false },
          { id: '2', text: 'second', completed: false },
        ])
        yield* closeHeads
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
  Vitest.scopedLive('filters events by name', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const eventFactory = EventFactory.makeFactory(fixtureEvents)({
          client: EventFactory.clientIdentity('client-1', 'session-1'),
        })

        const encodedEvents = [
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '1', text: 'first', completed: false })),
          toEncodedWithMeta(eventFactory.todoCompleted.next({ id: '1' })),
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '2', text: 'second', completed: false })),
          toEncodedWithMeta(eventFactory.todoCompleted.next({ id: '2' })),
        ]

        yield* insertEvents(dbEventlog, encodedEvents)

        const stream = streamEventsWithSyncState({
          dbEventlog,
          dbState,
          syncState,
          options: {
            since: EventSequenceNumber.ROOT,
            filter: ['todoCompleted'],
          },
        })

        const collectedFiber = yield* stream.pipe(Stream.take(2), Stream.runCollect).pipe(Effect.forkScoped)

        yield* advanceHead(encodedEvents.at(-1)!.seqNum)

        const emitted = Chunk.toReadonlyArray(yield* collectedFiber.pipe(Fiber.join))
        expect(emitted.map((event) => event.name)).toEqual(['todoCompleted', 'todoCompleted'])
        yield* closeHeads
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
  Vitest.scopedLive('finalises when reaching until head', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const eventFactory = EventFactory.makeFactory(fixtureEvents)({
          client: EventFactory.clientIdentity('client-1', 'session-1'),
        })

        const encodedEvents = [
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '1', text: 'first', completed: false })),
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '2', text: 'second', completed: false })),
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '3', text: 'third', completed: false })),
        ]

        yield* insertEvents(dbEventlog, encodedEvents)

        const stream = streamEventsWithSyncState({
          dbEventlog,
          dbState,
          syncState,
          options: {
            since: EventSequenceNumber.ROOT,
            until: encodedEvents[1]!.seqNum,
          },
        })

        yield* advanceHead(encodedEvents[1]!.seqNum)

        const collectFiber = yield* stream.pipe(Stream.runCollect).pipe(Effect.forkScoped)

        const emitted = Chunk.toReadonlyArray(yield* collectFiber.pipe(Fiber.join))
        yield* closeHeads
        expect(emitted.length).toEqual(2)
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
  Vitest.scopedLive('excludes events at the since cursor', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const eventFactory = EventFactory.makeFactory(fixtureEvents)({
          client: EventFactory.clientIdentity('client-1', 'session-1'),
        })

        const first = toEncodedWithMeta(eventFactory.todoCreated.next({ id: '1', text: 'first', completed: false }))
        const second = toEncodedWithMeta(eventFactory.todoCreated.next({ id: '2', text: 'second', completed: false }))

        yield* insertEvents(dbEventlog, [first, second])

        const stream = streamEventsWithSyncState({
          dbEventlog,
          dbState,
          syncState,
          options: {
            since: first.seqNum,
          },
        })

        const collectedFiber = yield* stream.pipe(Stream.take(1), Stream.runCollect).pipe(Effect.forkScoped)

        yield* advanceHead(second.seqNum)

        const emitted = Chunk.toReadonlyArray(yield* collectedFiber.pipe(Fiber.join))
        expect(emitted.map((event) => event.seqNum)).toEqual([second.seqNum])
        yield* closeHeads
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
  Vitest.scopedLive('filters events by client ID', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const clientAFactory = EventFactory.makeFactory(fixtureEvents)({
          client: EventFactory.clientIdentity('client-a', 'session-1'),
        })
        const clientBFactory = EventFactory.makeFactory(fixtureEvents)({
          client: EventFactory.clientIdentity('client-b', 'session-2'),
          startSeq: 2,
          initialParent: 1,
        })

        const eventA = toEncodedWithMeta(clientAFactory.todoCreated.next({ id: '1', text: 'first', completed: false }))
        const eventB = toEncodedWithMeta(clientBFactory.todoCreated.next({ id: '2', text: 'second', completed: false }))

        yield* insertEvents(dbEventlog, [eventA, eventB])

        const stream = streamEventsWithSyncState({
          dbEventlog,
          dbState,
          syncState,
          options: {
            since: EventSequenceNumber.ROOT,
            clientIds: ['client-b'] as const,
          },
        })

        const collectedFiber = yield* stream.pipe(Stream.take(1), Stream.runCollect).pipe(Effect.forkScoped)

        yield* advanceHead(eventB.seqNum)

        const emitted = Chunk.toReadonlyArray(yield* collectedFiber.pipe(Fiber.join))
        expect(emitted.map((event) => event.clientId)).toEqual(['client-b'])
        yield* closeHeads
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
  Vitest.scopedLive('filters events by session ID', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const sessionOneFactory = EventFactory.makeFactory(fixtureEvents)({
          client: EventFactory.clientIdentity('client-shared', 'session-1'),
        })
        const sessionTwoFactory = EventFactory.makeFactory(fixtureEvents)({
          client: EventFactory.clientIdentity('client-shared', 'session-2'),
          startSeq: 2,
          initialParent: 1,
        })

        const eventSessionOne = toEncodedWithMeta(
          sessionOneFactory.todoCreated.next({ id: '1', text: 'first', completed: false }),
        )
        const eventSessionTwo = toEncodedWithMeta(
          sessionTwoFactory.todoCreated.next({ id: '2', text: 'second', completed: false }),
        )

        yield* insertEvents(dbEventlog, [eventSessionOne, eventSessionTwo])

        const stream = streamEventsWithSyncState({
          dbEventlog,
          dbState,
          syncState,
          options: {
            since: EventSequenceNumber.ROOT,
            sessionIds: ['session-2'] as const,
          },
        })

        const collectedFiber = yield* stream.pipe(Stream.take(1), Stream.runCollect).pipe(Effect.forkScoped)

        yield* advanceHead(eventSessionTwo.seqNum)

        const emitted = Chunk.toReadonlyArray(yield* collectedFiber.pipe(Fiber.join))
        expect(emitted.map((event) => event.sessionId)).toEqual(['session-2'])
        yield* closeHeads
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )

  const batchSizeSampleSchema = Schema.Literal(1, 2, 4, 5, 10)
  const eventCountSampleSchema = Schema.Literal(1, 2, 3, 4, 5, 7, 9, 10, 11, 13, 15, 16)
  const batchesPerTickSampleSchema = Schema.Literal(1, 2, 3, 10)

  Vitest.asProp(
    Vitest.scopedLive,
    'property: streams events across batches',
    {
      batchSize: batchSizeSampleSchema,
      eventCount: eventCountSampleSchema,
      batchesPerTick: batchesPerTickSampleSchema,
    },
    ({ batchSize, eventCount, batchesPerTick }, test, { numRuns, runIndex }) =>
      withNodeFs(
        Effect.gen(function* () {
          console.log(`Run ${runIndex + 1}/${numRuns}`, {
            batchSize,
            eventCount,
            batchesPerTick,
          })

          const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

          const eventFactory = EventFactory.makeFactory(fixtureEvents)({
            client: EventFactory.clientIdentity('client-1', 'session-1'),
          })

          const generatedEvents = Array.from({ length: eventCount }, (_, index) =>
            toEncodedWithMeta(
              eventFactory.todoCreated.next({
                id: `${index + 1}`,
                text: `todo-${index + 1}`,
                completed: false,
              }),
            ),
          )

          yield* insertEvents(dbEventlog, generatedEvents)

          const stream = streamEventsWithSyncState({
            dbEventlog,
            dbState,
            syncState,
            options: {
              since: EventSequenceNumber.ROOT,
              batchSize,
            },
          })

          const collectFiber = yield* stream.pipe(Stream.take(eventCount), Stream.runCollect).pipe(Effect.forkScoped)

          const tickSize = batchSize * batchesPerTick
          for (let index = tickSize; index < generatedEvents.length; index += tickSize) {
            yield* advanceHead(generatedEvents[index - 1]!.seqNum)
          }
          yield* advanceHead(generatedEvents.at(-1)!.seqNum)

          const emitted = Chunk.toReadonlyArray(yield* collectFiber.pipe(Fiber.join))

          expect(emitted.length).toEqual(eventCount)
          expect(emitted.map((event) => event.seqNum.global)).toEqual(
            generatedEvents.map((event) => event.seqNum.global),
          )

          yield* closeHeads
        }).pipe(Vitest.withTestCtx(test)),
      ),
    { fastCheck: { numRuns: 20 } },
  )
})
