import { expect } from 'vitest'

import type { BootStatus, SqliteDb } from '@livestore/common'
import { Eventlog, LeaderPersistence, makeMaterializeEvent, recreateDb } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent, SystemTables } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Option, Queue } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { events, getStateHead, makeSqliteServicesLayer, schema, tables } from './fixture.ts'

/** Verifies: LS.SYS.STATE-R03, LS.SYS.STATE.SQLITE-R06, LS.SYS.SYNC-R06 */
Vitest.describe.concurrent('LeaderPersistence', () => {
  Vitest.live('commits local events without mutating the plan', (test) =>
    Effect.gen(function* () {
      const { persistence, dbEventlog, dbState } = yield* setup
      const event = makeTodoEvent({ global: 1, id: 'local', text: 'Local' })
      const eventBefore = structuredClone(event)

      const receipt = yield* persistence.persistLocal({ events: [event] })

      expect(dbState.select('SELECT id, text FROM todos')).toEqual([{ id: 'local', text: 'Local' }])
      expect(dbEventlog.select<{ name: string }>('SELECT name FROM eventlog')).toEqual([
        { name: events.todoCreated.name },
      ])
      expect(yield* getStateHead(dbState)).toEqual(event.seqNum)

      expect(event).toStrictEqual(eventBefore)
      expect(receipt.persistedEvents).toEqual([event])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('rolls back both databases when an upstream batch fails during materialization', (test) =>
    Effect.gen(function* () {
      const { persistence, dbEventlog, dbState } = yield* setup
      const first = makeTodoEvent({ global: 1, id: 'duplicate', text: 'First' })
      const duplicate = makeTodoEvent({ global: 2, parentSeqNum: first.seqNum, id: 'duplicate', text: 'Second' })

      const error = yield* persistence
        .persistUpstream({
          pulledEvents: [pulled(first), pulled(duplicate)],
          events: [first, duplicate],
          rollbackEvents: [],
          confirmedEvents: [],
          backendHead: duplicate.seqNum,
        })
        .pipe(Effect.flip)

      expect(error._tag).toEqual('MaterializeError')
      expect(snapshot(dbState, dbEventlog)).toEqual(emptySnapshot)
      expect(yield* getStateHead(dbState)).toEqual(EventSequenceNumber.Client.ROOT)
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('rolls back a local batch in both databases when it fails partway', (test) =>
    Effect.gen(function* () {
      const { persistence, dbEventlog, dbState } = yield* setup
      const first = makeTodoEvent({ global: 1, id: 'duplicate', text: 'First' })
      const duplicate = makeTodoEvent({ global: 2, parentSeqNum: first.seqNum, id: 'duplicate', text: 'Second' })

      const error = yield* persistence.persistLocal({ events: [first, duplicate] }).pipe(Effect.flip)

      expect(error._tag).toEqual('MaterializeError')
      expect(snapshot(dbState, dbEventlog)).toEqual(emptySnapshot)
      expect(yield* getStateHead(dbState)).toEqual(EventSequenceNumber.Client.ROOT)
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live(
    'restores rollback, eventlog, journal and heads when an upstream rebase fails at its last write',
    (test) =>
      Effect.gen(function* () {
        const { persistence, dbEventlog, dbState } = yield* setup
        // More than one 100-key chunk, so earlier eventlog and journal delete chunks must be restored too.
        const pending = Array.from({ length: 101 }, (_, i) =>
          makeTodoEvent({
            global: i + 1,
            parentSeqNum: EventSequenceNumber.Client.Composite.make({ global: i, client: 0 }),
            id: `pending-${i + 1}`,
            text: 'Pending',
          }),
        )
        yield* persistence.persistLocal({ events: pending })
        const before = snapshot(dbState, dbEventlog)
        const headBefore = yield* getStateHead(dbState)
        expect(before.journal).toHaveLength(pending.length)

        // The backend head is written after rollback, materialization and journal pruning.
        dbEventlog.execute(`
        CREATE TRIGGER fail_backend_head
        BEFORE UPDATE ON __livestore_sync_status
        BEGIN
          SELECT RAISE(ABORT, 'backend head write failed');
        END
      `)
        const replacement = makeTodoEvent({ global: 1, rebaseGeneration: 1, id: 'replacement', text: 'Replacement' })

        const error = yield* persistence
          .persistUpstream({
            pulledEvents: [pulled(replacement)],
            events: [replacement],
            rollbackEvents: pending,
            confirmedEvents: [],
            backendHead: replacement.seqNum,
          })
          .pipe(Effect.flip)

        expect(error._tag).toEqual('MaterializeError')
        expect(snapshot(dbState, dbEventlog)).toEqual(before)
        expect(yield* getStateHead(dbState)).toEqual(headBefore)
      }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('replaces rolled-back history and advances the backend head in one upstream commit', (test) =>
    Effect.gen(function* () {
      const { persistence, dbEventlog, dbState } = yield* setup
      const original = makeTodoEvent({ global: 1, id: 'original', text: 'Original' })
      yield* persistence.persistLocal({ events: [original] })

      const replacement = makeTodoEvent({
        global: 1,
        rebaseGeneration: 1,
        id: 'replacement',
        text: 'Replacement',
      })

      const receipt = yield* persistence.persistUpstream({
        pulledEvents: [pulled(replacement, Option.some({ cursor: 'upstream-1' }))],
        events: [replacement],
        rollbackEvents: [original],
        confirmedEvents: [],
        backendHead: replacement.seqNum,
      })

      expect(dbState.select('SELECT id, text FROM todos')).toEqual([{ id: 'replacement', text: 'Replacement' }])
      expect(
        dbEventlog.select<{ seqNumRebaseGeneration: number }>('SELECT seqNumRebaseGeneration FROM eventlog'),
      ).toEqual([{ seqNumRebaseGeneration: 1 }])
      expect(Eventlog.getBackendHeadFromDb(dbEventlog)).toEqual(1)
      expect(yield* getStateHead(dbState)).toEqual(replacement.seqNum)
      expect(dbState.select(SystemTables.materializationJournalMetaTable)).toEqual([])
      expect(receipt.rolledBackEventNums).toEqual([original.seqNum])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('persists confirmation metadata with the matching backend head', (test) =>
    Effect.gen(function* () {
      const { persistence, dbEventlog, dbState } = yield* setup
      const pending = makeTodoEvent({
        global: 1,
        rebaseGeneration: 2,
        id: 'confirmed',
        text: 'Confirmed',
      })
      yield* persistence.persistLocal({ events: [pending] })
      const upstream = makeTodoEvent({ global: 1, id: 'confirmed', text: 'Confirmed' })

      yield* persistence.persistUpstream({
        pulledEvents: [pulled(upstream, Option.some({ cursor: 'confirmed-1' }))],
        events: [],
        rollbackEvents: [],
        confirmedEvents: [pending],
        backendHead: upstream.seqNum,
      })

      const cursorInfo = yield* Eventlog.getSyncBackendCursorInfoForDb(dbEventlog, {
        remoteHead: upstream.seqNum.global,
      })
      expect(Option.getOrThrow(cursorInfo)).toEqual({
        eventSequenceNumber: 1,
        metadata: Option.some({ cursor: 'confirmed-1' }),
      })
      expect(Eventlog.getBackendHeadFromDb(dbEventlog)).toEqual(1)
      expect(dbState.select(SystemTables.materializationJournalMetaTable)).toEqual([])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
})

const setup = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
  const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
  yield* Eventlog.initEventlogDb(dbEventlog)

  const servicesLayer = makeSqliteServicesLayer({ dbState, dbEventlog })
  const materializeEvent = yield* makeMaterializeEvent({ schema }).pipe(Effect.provide(servicesLayer))

  const bootStatusQueue = yield* Queue.unbounded<BootStatus>()
  yield* recreateDb({ schema, bootStatusQueue, materializeEvent }).pipe(Effect.provide(servicesLayer))
  yield* Queue.shutdown(bootStatusQueue)

  const persistence = yield* LeaderPersistence.make({ materializeEvent }).pipe(Effect.provide(servicesLayer))

  return { persistence, dbEventlog, dbState }
})

/** Durable rows a failed persistence transaction must leave untouched. */
const snapshot = (dbState: SqliteDb, dbEventlog: SqliteDb) => ({
  todos: dbState.select(tables.todos),
  journal: dbState.select(SystemTables.materializationJournalMetaTable),
  eventlog: dbEventlog.select(SystemTables.eventlogMetaTable),
  backendHead: Eventlog.getBackendHeadFromDb(dbEventlog),
})

const emptySnapshot = { todos: [], journal: [], eventlog: [], backendHead: EventSequenceNumber.Client.ROOT.global }

const makeTodoEvent = ({
  global,
  rebaseGeneration = 0,
  parentSeqNum = EventSequenceNumber.Client.ROOT,
  id,
  text,
}: {
  global: number
  rebaseGeneration?: number
  parentSeqNum?: EventSequenceNumber.Client.Composite
  id: string
  text: string
}) =>
  LiveStoreEvent.Client.Encoded.make({
    name: events.todoCreated.name,
    args: { id, text },
    seqNum: EventSequenceNumber.Client.Composite.make({ global, client: 0, rebaseGeneration }),
    parentSeqNum,
    clientId: 'test-client',
    sessionId: 'test-session',
  })

const pulled = (
  event: LiveStoreEvent.Client.Encoded,
  syncMetadata: Option.Option<{ cursor: string }> = Option.none(),
): LeaderPersistence.PulledEvent => ({ event, syncMetadata })
