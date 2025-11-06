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

import { appConfigSetEvent, events as fixtureEvents, schema as fixtureSchema } from './fixture.ts'

const allFixtureEvents = {
  ...fixtureEvents,
  app_configSet: appConfigSetEvent,
} as const

const makeFixtureEventFactory = EventFactory.makeFactory(allFixtureEvents)

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

const makeClientOnlyEvent = ({
  base,
  event,
}: {
  base: EventSequenceNumber.EventSequenceNumber
  event: LiveStoreEvent.AnyEncodedGlobal
}): {
  encoded: LiveStoreEvent.EncodedWithMeta
  nextBase: EventSequenceNumber.EventSequenceNumber
} => {
  const nextPair = EventSequenceNumber.nextPair({
    seqNum: base,
    isClient: true,
    rebaseGeneration: base.rebaseGeneration,
  })

  return {
    encoded: LiveStoreEvent.EncodedWithMeta.make({
      name: event.name,
      args: event.args,
      seqNum: nextPair.seqNum,
      parentSeqNum: nextPair.parentSeqNum,
      clientId: event.clientId,
      sessionId: event.sessionId,
    }),
    nextBase: nextPair.seqNum,
  }
}

const insertEvents = (dbEventlog: unknown, events: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>) =>
  Effect.forEach(events, (event) =>
    Effect.gen(function* () {
      const eventDef = fixtureSchema.eventsDefsMap.get(event.name)
      if (eventDef === undefined) {
        throw new Error(`Missing schema for event ${event.name}`)
      }

      yield* Eventlog.insertIntoEventlog(
        event,
        dbEventlog as any,
        Schema.hash(eventDef.schema),
        event.clientId,
        event.sessionId,
      )
    }),
  )

Vitest.describe.concurrent('streamEventsWithSyncState', () => {
  Vitest.scopedLive('emits events as upstream head advances', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const eventFactory = makeFixtureEventFactory({
          client: EventFactory.clientIdentity('client-1', 'session-1'),
        })

        const initialEvents = [
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '1', text: 'first', completed: false })),
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '2', text: 'second', completed: false })),
        ]

        yield* insertEvents(dbEventlog, initialEvents)

        const stream = streamEventsWithSyncState({
          dbEventlog,
          dbState,
          syncState,
          options: {
            since: EventSequenceNumber.ROOT,
          },
        })

        const collectFiber = yield* stream.pipe(Stream.take(4), Stream.runCollect).pipe(Effect.forkScoped)

        yield* advanceHead(initialEvents[1]!.seqNum)

        const laterEvents = [
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '3', text: 'third', completed: false })),
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '4', text: 'fourth', completed: false })),
        ]

        yield* insertEvents(dbEventlog, laterEvents)

        yield* advanceHead(laterEvents[1]!.seqNum)

        const collected = yield* collectFiber.pipe(Fiber.join)
        const emitted = Chunk.toReadonlyArray(collected)

        expect(emitted.map((event) => event.name)).toEqual([
          fixtureEvents.todoCreated.name,
          fixtureEvents.todoCreated.name,
          fixtureEvents.todoCreated.name,
          fixtureEvents.todoCreated.name,
        ])
        expect(emitted.map((event) => event.args)).toEqual([
          { id: '1', text: 'first', completed: false },
          { id: '2', text: 'second', completed: false },
          { id: '3', text: 'third', completed: false },
          { id: '4', text: 'fourth', completed: false },
        ])
        yield* closeHeads
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
  Vitest.scopedLive('filters events by name', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const eventFactory = makeFixtureEventFactory({
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

        const eventFactory = makeFixtureEventFactory({
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

        // Stream.take(n) here is omitted to verify that the stream finalizes when reaching until cursor
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

        const eventFactory = makeFixtureEventFactory({
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

        const clientAFactory = makeFixtureEventFactory({
          client: EventFactory.clientIdentity('client-a', 'session-1'),
        })
        const clientBFactory = makeFixtureEventFactory({
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

        const sessionOneFactory = makeFixtureEventFactory({
          client: EventFactory.clientIdentity('client-shared', 'session-1'),
        })
        const sessionTwoFactory = makeFixtureEventFactory({
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
  Vitest.scopedLive('skips client-only events by default', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

        const eventFactory = makeFixtureEventFactory({
          client: EventFactory.clientIdentity('client-1', 'session-1'),
        })

        const backendApproved = [
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '1', text: 'first', completed: false })),
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '2', text: 'second', completed: false })),
          toEncodedWithMeta(eventFactory.todoCreated.next({ id: '3', text: 'third', completed: false })),
        ]

        let clientBase = backendApproved[backendApproved.length - 1]!.seqNum
        const appConfigSetFactory = eventFactory.app_configSet

        const clientOnlyEvents = [
          { value: { theme: 'dark' } },
          { value: { fontSize: 18 } },
          { value: { theme: 'light', fontSize: 20 } },
        ].map((payload) => {
          const { encoded, nextBase } = makeClientOnlyEvent({
            base: clientBase,
            event: appConfigSetFactory.next({ id: 'session-1', ...payload }),
          })
          clientBase = nextBase
          return encoded
        })

        yield* insertEvents(dbEventlog, [...backendApproved, ...clientOnlyEvents])

        const stream = streamEventsWithSyncState({
          dbEventlog,
          dbState,
          syncState,
          options: {
            since: EventSequenceNumber.ROOT,
          },
        })

        const collectFiber = yield* stream
          .pipe(Stream.take(backendApproved.length), Stream.runCollect)
          .pipe(Effect.forkScoped)

        yield* advanceHead(backendApproved[backendApproved.length - 1]!.seqNum)

        const emitted = Chunk.toReadonlyArray(yield* collectFiber.pipe(Fiber.join))

        expect(emitted).toHaveLength(backendApproved.length)
        expect(emitted.map((event) => event.seqNum.global)).toEqual(backendApproved.map((event) => event.seqNum.global))
        expect(emitted.every((event) => event.seqNum.client <= 0)).toBe(true)

        yield* closeHeads
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )

  const batchSizeSampleSchema = Schema.Literal(1, 5, 12, 25, 50, 100)
  const eventCountSampleSchema = Schema.Literal(0, 1, 6, 10, 100)
  const batchesPerTickSampleSchema = Schema.Literal(1, 3, 10, 100)

  Vitest.asProp(
    Vitest.scopedLive,
    'property: streams events across batches',
    {
      batchSize: batchSizeSampleSchema,
      eventCount: eventCountSampleSchema,
      batchesPerTick: batchesPerTickSampleSchema,
    },
    ({ batchSize, eventCount, batchesPerTick }, test) =>
      withNodeFs(
        Effect.gen(function* () {
          const { dbEventlog, dbState, syncState, advanceHead, closeHeads } = yield* makeTestEnvironment

          // console.log('batchSize', batchSize, 'eventCount', eventCount, 'batchesPerTick', batchesPerTick)

          const eventFactory = makeFixtureEventFactory({
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
          if (eventCount > 0) {
            // Ensure that head is moved to last event if batchSize * batchesPerTick != eventSize
            yield* advanceHead(generatedEvents.at(-1)!.seqNum)
          }

          const emitted = Chunk.toReadonlyArray(yield* collectFiber.pipe(Fiber.join))

          expect(emitted.length).toEqual(eventCount)
          expect(emitted.map((event) => event.seqNum.global)).toEqual(
            generatedEvents.map((event) => event.seqNum.global),
          )

          yield* closeHeads
        }).pipe(Vitest.withTestCtx(test)),
      ),
    {},
  )
})
