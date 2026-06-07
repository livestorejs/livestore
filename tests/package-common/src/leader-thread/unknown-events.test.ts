import { MaterializationJournal, migrateDb, rematerializeFromEventlog, sql, StateHead } from '@livestore/common'
import { Eventlog, makeMaterializeEvent } from '@livestore/common/leader-thread'
import type { UnknownEvents } from '@livestore/common/schema'
import {
  EventSequenceNumber,
  Events,
  LiveStoreEvent,
  makeSchema,
  State,
  UNKNOWN_EVENT_SCHEMA_HASH,
} from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect, Layer, Schema } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { events as fixtureEvents, schema as fixtureSchema } from './fixture.ts'

// Verifies the behaviour of LiveStore's unknown-event handling strategies across
// materialization paths, ensuring events are either skipped, logged, or cause
// structured failures according to the selected strategy.

Vitest.describe.concurrent('unknown event handling in materializeEvent', () => {
  Vitest.scopedLive('warn strategy keeps event in log and continues', (test) =>
    Effect.gen(function* () {
      const { materializeEvent, dbEventlog, materializationJournal } = yield* setup({ strategy: 'warn' })
      const event = makeUnknownEncodedEvent()

      yield* materializeEvent(event, { skipEventlog: false })

      const record = yield* materializationJournal.get(event.seqNum)
      expect(record._tag === 'Some' && record.value.sessionChangeset._tag).toEqual('no-op')

      const rows = dbEventlog.select<{ name: string; schemaHash: number }>(sql`SELECT name, schemaHash FROM eventlog`)
      expect(rows).toEqual([{ name: event.name, schemaHash: UNKNOWN_EVENT_SCHEMA_HASH }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('ignore strategy behaves like warn but silent', (test) =>
    Effect.gen(function* () {
      const { materializeEvent, dbEventlog, materializationJournal } = yield* setup({ strategy: 'ignore' })
      const event = makeUnknownEncodedEvent()

      yield* materializeEvent(event, {})

      const record = yield* materializationJournal.get(event.seqNum)
      expect(record._tag === 'Some' && record.value.sessionChangeset._tag).toEqual('no-op')

      const rows = dbEventlog.select<{ name: string; schemaHash: number }>(sql`SELECT name, schemaHash FROM eventlog`)
      expect(rows).toEqual([{ name: event.name, schemaHash: UNKNOWN_EVENT_SCHEMA_HASH }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('fail strategy surfaces UnknownEventError', (test) =>
    Effect.gen(function* () {
      const { materializeEvent } = yield* setup({ strategy: 'fail' })
      const event = makeUnknownEncodedEvent()

      const result = yield* materializeEvent(event, {}).pipe(Effect.either)
      if (result._tag !== 'Left') {
        throw new Error('Expected materializeEvent to fail for fail strategy')
      }
      const error = result.left
      expect(error._tag).toEqual('MaterializeError')
      if (error.cause._tag !== 'UnknownEventError') {
        throw new Error(`Unexpected failure cause: ${error.cause._tag}`)
      }
      expect(error.cause.reason).toEqual('event-definition-missing')
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('callback strategy invokes observer once', (test) =>
    Effect.gen(function* () {
      const calls: Array<{ eventName: string; reason: string }> = []
      const { materializeEvent, materializationJournal } = yield* setup({
        strategy: 'callback',
        onUnknownEvent: (context, error) => {
          calls.push({ eventName: context.event.name, reason: error.reason })
        },
      })
      const event = makeUnknownEncodedEvent()

      yield* materializeEvent(event, {})

      const record = yield* materializationJournal.get(event.seqNum)
      expect(record._tag === 'Some' && record.value.sessionChangeset._tag).toEqual('no-op')
      expect(calls).toEqual([{ eventName: event.name, reason: 'event-definition-missing' }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('warn strategy skips events missing materializers', (test) =>
    Effect.gen(function* () {
      const knownEvent = Events.synced({
        name: 'known-event',
        schema: Schema.Struct({ value: Schema.String }),
      })

      const schema = makeSchema({
        events: [knownEvent],
        state: State.SQLite.makeState({ tables: {}, materializers: {} }),
        unknownEventHandling: { strategy: 'warn' },
      })

      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
      const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
      yield* Eventlog.initEventlogDb(dbEventlog)
      yield* migrateDb({ db: dbState, schema })

      const materializationJournal = MaterializationJournal.make({ dbState })
      const materializeEvent = yield* makeMaterializeEvent({ schema, dbState, dbEventlog }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(MaterializationJournal.MaterializationJournal, materializationJournal),
            StateHead.layer({ dbState }),
          ),
        ),
      )

      const event = new LiveStoreEvent.Client.EncodedWithMeta({
        name: 'known-event',
        args: { value: 'example' },
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'client-2',
        sessionId: 'session-2',
      })

      yield* materializeEvent(event, {})

      const record = yield* materializationJournal.get(event.seqNum)
      expect(record._tag === 'Some' && record.value.sessionChangeset._tag).toEqual('no-op')
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('materialization journal rollback does not mutate state head', (test) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
      const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
      yield* Eventlog.initEventlogDb(dbEventlog)
      yield* migrateDb({ db: dbState, schema: fixtureSchema })

      const materializationJournal = MaterializationJournal.make({ dbState })
      const stateHead = StateHead.make({ dbState })
      const materializeEvent = yield* makeMaterializeEvent({ schema: fixtureSchema, dbState, dbEventlog }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(MaterializationJournal.MaterializationJournal, materializationJournal),
            Layer.succeed(StateHead.StateHead, stateHead),
          ),
        ),
      )

      const event = new LiveStoreEvent.Client.EncodedWithMeta({
        name: fixtureEvents.todoCreated.name,
        args: { id: 'head-is-not-journaled', text: 'example', completed: false },
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'client-3',
        sessionId: 'session-3',
      })

      yield* materializeEvent(event, {})
      expect(yield* stateHead.get()).toEqual(event.seqNum)

      yield* materializationJournal.rollback([event.seqNum])

      expect(yield* stateHead.get()).toEqual(event.seqNum)
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('rematerialization advances state head over unknown no-op events', (test) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
      const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
      yield* Eventlog.initEventlogDb(dbEventlog)
      yield* migrateDb({ db: dbState, schema: fixtureSchema })

      const materializationJournal = MaterializationJournal.make({ dbState })
      const stateHead = StateHead.make({ dbState })
      const materializeEvent = yield* makeMaterializeEvent({ schema: fixtureSchema, dbState, dbEventlog }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(MaterializationJournal.MaterializationJournal, materializationJournal),
            Layer.succeed(StateHead.StateHead, stateHead),
          ),
        ),
      )

      const knownEvent = new LiveStoreEvent.Client.EncodedWithMeta({
        name: fixtureEvents.todoCreated.name,
        args: { id: 'known-before-unknown', text: 'known', completed: false },
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'client-rematerialize',
        sessionId: 'session-rematerialize',
      })
      const unknownEvent = new LiveStoreEvent.Client.EncodedWithMeta({
        name: 'v2.FutureEvent',
        args: { payload: 'future' },
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 2, client: 0 }),
        parentSeqNum: knownEvent.seqNum,
        clientId: 'client-rematerialize',
        sessionId: 'session-rematerialize',
      })

      yield* Eventlog.insertIntoEventlog(
        knownEvent,
        dbEventlog,
        Schema.hash(fixtureEvents.todoCreated.schema),
        knownEvent.clientId,
        knownEvent.sessionId,
      )
      yield* Eventlog.insertIntoEventlog(
        unknownEvent,
        dbEventlog,
        UNKNOWN_EVENT_SCHEMA_HASH,
        unknownEvent.clientId,
        unknownEvent.sessionId,
      )

      yield* rematerializeFromEventlog({
        dbEventlog,
        schema: fixtureSchema,
        materializeEvent,
        onProgress: () => Effect.void,
      })

      expect(yield* stateHead.get()).toEqual(unknownEvent.seqNum)

      const unknownRecord = yield* materializationJournal.get(unknownEvent.seqNum)
      expect(unknownRecord._tag === 'Some' && unknownRecord.value.sessionChangeset._tag).toEqual('no-op')
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
})

const makeUnknownEncodedEvent = () =>
  new LiveStoreEvent.Client.EncodedWithMeta({
    name: 'v1.UnknownEvent',
    args: { payload: 'test' },
    seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
    parentSeqNum: EventSequenceNumber.Client.ROOT,
    clientId: 'client-1',
    sessionId: 'session-1',
  })

const makeSchemaWith = (config: UnknownEvents.HandlingConfig) =>
  makeSchema({
    events: [],
    state: State.SQLite.makeState({ tables: {}, materializers: {} }),
    unknownEventHandling: config,
  })

const setup = (config: UnknownEvents.HandlingConfig) =>
  Effect.gen(function* () {
    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
      Effect.withSpan('tests:unknown-events:loadSqlite3Wasm'),
    )
    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
    const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
    const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

    const schema = makeSchemaWith(config)
    yield* Eventlog.initEventlogDb(dbEventlog)
    yield* migrateDb({ db: dbState, schema })

    const materializationJournal = MaterializationJournal.make({ dbState })
    const materializeEvent = yield* makeMaterializeEvent({ schema, dbState, dbEventlog }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(MaterializationJournal.MaterializationJournal, materializationJournal),
          StateHead.layer({ dbState }),
        ),
      ),
    )

    return { materializeEvent, dbEventlog, schema, materializationJournal }
  })
