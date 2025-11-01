import type { BootStatus } from '@livestore/common'
import { SyncState } from '@livestore/common'
import { Eventlog, makeMaterializeEvent, recreateDb, streamEventsWithSyncState } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import {
  Chunk,
  Effect,
  Fiber,
  Option,
  Queue,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'
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

  const syncStateRef = yield* SubscriptionRef.make(initialSyncState)
  const syncState = Subscribable.make({
    get: SubscriptionRef.get(syncStateRef),
    changes: syncStateRef.changes,
  })

  return { dbEventlog, dbState, syncStateRef, syncState }
})

const toEncodedWithMeta = (event: LiveStoreEvent.AnyEncodedGlobal): LiveStoreEvent.EncodedWithMeta =>
  LiveStoreEvent.EncodedWithMeta.fromGlobal(event, {
    syncMetadata: Option.none(),
    materializerHashLeader: Option.none(),
    materializerHashSession: Option.none(),
  })

const setUpstreamHead = ({
  syncStateRef,
  head,
}: {
  syncStateRef: SubscriptionRef.SubscriptionRef<SyncState.SyncState>
  head: EventSequenceNumber.EventSequenceNumber
}) =>
  SubscriptionRef.set(
    syncStateRef,
    SyncState.SyncState.make({
      pending: [],
      upstreamHead: head,
      localHead: head,
    }),
  )

Vitest.describe.concurrent('streamEventsWithSyncState', () => {
  Vitest.scopedLive('emits events as upstream head advances', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, dbState, syncStateRef, syncState } = yield* makeTestEnvironment

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
          since: EventSequenceNumber.ROOT,
        })

        const collectFiber = yield* stream.pipe(Stream.take(2), Stream.runCollect).pipe(Effect.forkScoped)

        yield* setUpstreamHead({ syncStateRef, head: EventSequenceNumber.make({ global: 1, client: 0 }) })
        yield* setUpstreamHead({ syncStateRef, head: EventSequenceNumber.make({ global: 2, client: 0 }) })

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
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
})
