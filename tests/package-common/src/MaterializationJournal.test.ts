import { expect } from 'vitest'

import {
  MATERIALIZATION_JOURNAL_META_TABLE,
  MaterializationJournal,
  migrateDb,
  prepareBindValues,
  SqliteError,
  sql,
  type MaterializationJournalMetaRow,
  type SqliteDb,
} from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { schema } from './leader-thread/fixture.ts'

const setup = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
  yield* migrateDb({ db: dbState, schema })
  dbState.execute('CREATE TABLE journal_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')

  return {
    dbState,
    journal: MaterializationJournal.make({ dbState }),
  }
})

Vitest.describe.concurrent('MaterializationJournal', () => {
  Vitest.live('replaces the changeset at an existing materialization key', (test) =>
    Effect.gen(function* () {
      const { dbState, journal } = yield* setup

      const key = EventSequenceNumber.Client.Composite.make({ global: 1, client: 2, rebaseGeneration: 3 })
      yield* journal.record({
        key,
        changeset: Uint8Array.from([1, 2, 3]),
      })

      const replacementChangeset = Uint8Array.from([4, 5, 6])
      yield* journal.record({
        key,
        changeset: replacementChangeset,
      })

      expect(getRecord(dbState, key)).toEqual({
        key,
        changeset: replacementChangeset,
      })
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('discards records up to the key', (test) =>
    Effect.gen(function* () {
      const { dbState, journal } = yield* setup

      const key = EventSequenceNumber.Client.Composite.make({ global: 1, client: 2, rebaseGeneration: 3 })
      yield* journal.record({ key, changeset: null })

      const sameSequenceKey = EventSequenceNumber.Client.Composite.make({
        global: 1,
        client: 2,
        rebaseGeneration: 4,
      })
      yield* journal.record({ key: sameSequenceKey, changeset: null })

      const laterKey = EventSequenceNumber.Client.Composite.make({ global: 1, client: 3, rebaseGeneration: 0 })
      yield* journal.record({ key: laterKey, changeset: null })

      yield* journal.discardUpTo(key)

      expect(getRecord(dbState, key)).toBeUndefined()
      expect(getRecord(dbState, sameSequenceKey)).toBeUndefined()
      expect(getRecord(dbState, laterKey)).toEqual({
        key: laterKey,
        changeset: null,
      })
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('rolls changesets back in reverse materialization order and removes their records', (test) =>
    Effect.gen(function* () {
      const { dbState, journal } = yield* setup

      const insertKey = EventSequenceNumber.Client.Composite.make({ global: 1, client: 0, rebaseGeneration: 0 })
      const insertChangeset = captureChangeset(dbState, () => {
        dbState.execute("INSERT INTO journal_test (id, value) VALUES (1, 'created')")
      })
      yield* journal.record({
        key: insertKey,
        changeset: insertChangeset,
      })

      const updateKey = EventSequenceNumber.Client.Composite.make({ global: 2, client: 0, rebaseGeneration: 0 })
      const updateChangeset = captureChangeset(dbState, () => {
        dbState.execute("UPDATE journal_test SET value = 'updated' WHERE id = 1")
      })
      yield* journal.record({
        key: updateKey,
        changeset: updateChangeset,
      })

      const noOpKey = EventSequenceNumber.Client.Composite.make({ global: 3, client: 0, rebaseGeneration: 0 })
      yield* journal.record({ key: noOpKey, changeset: null })

      yield* journal.rollback([insertKey, noOpKey, updateKey])

      expect(dbState.select('SELECT id, value FROM journal_test')).toEqual([])
      expect(getRecord(dbState, insertKey)).toBeUndefined()
      expect(getRecord(dbState, updateKey)).toBeUndefined()
      expect(getRecord(dbState, noOpKey)).toBeUndefined()
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('fails without changing state when a requested record is missing', (test) =>
    Effect.gen(function* () {
      const { dbState, journal } = yield* setup

      const recordedKey = EventSequenceNumber.Client.Composite.make({ global: 2, client: 0, rebaseGeneration: 0 })
      const changeset = captureChangeset(dbState, () => {
        dbState.execute("INSERT INTO journal_test (id, value) VALUES (1, 'kept')")
      })
      yield* journal.record({
        key: recordedKey,
        changeset,
      })

      const missingKey = EventSequenceNumber.Client.Composite.make({ global: 1, client: 0, rebaseGeneration: 0 })
      const error = yield* journal.rollback([recordedKey, missingKey]).pipe(Effect.flip)
      expect(error).toBeInstanceOf(MaterializationJournal.MaterializationJournalError)
      expect(error.method).toEqual('rollback')
      expect(error.cause).toEqual(
        new Error(`Missing materialization journal record for ${EventSequenceNumber.Client.toString(missingKey)}`),
      )

      expect(dbState.select('SELECT id, value FROM journal_test')).toEqual([{ id: 1, value: 'kept' }])
      expect(getRecord(dbState, recordedKey)).toEqual({
        key: recordedKey,
        changeset,
      })
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('restores earlier inverse changes when a later changeset fails', (test) =>
    Effect.gen(function* () {
      const { dbState, journal } = yield* setup

      const validKey = EventSequenceNumber.Client.Composite.make({ global: 2, client: 0, rebaseGeneration: 0 })
      const validChangeset = captureChangeset(dbState, () => {
        dbState.execute("INSERT INTO journal_test (id, value) VALUES (1, 'kept')")
      })
      yield* journal.record({
        key: validKey,
        changeset: validChangeset,
      })

      const invalidKey = EventSequenceNumber.Client.Composite.make({ global: 1, client: 0, rebaseGeneration: 0 })
      const invalidChangeset = Uint8Array.from([1, 2, 3])
      yield* journal.record({
        key: invalidKey,
        changeset: invalidChangeset,
      })

      const error = yield* journal.rollback([validKey, invalidKey]).pipe(Effect.flip)
      expect(error).toBeInstanceOf(MaterializationJournal.MaterializationJournalError)
      expect(error.method).toEqual('rollback')
      expect(error.cause).toBeInstanceOf(SqliteError)

      expect(dbState.select('SELECT id, value FROM journal_test')).toEqual([{ id: 1, value: 'kept' }])
      expect(getRecord(dbState, validKey)).toEqual({
        key: validKey,
        changeset: validChangeset,
      })
      expect(getRecord(dbState, invalidKey)).toEqual({
        key: invalidKey,
        changeset: invalidChangeset,
      })
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
})

const getRecord = (
  dbState: SqliteDb,
  key: EventSequenceNumber.Client.Composite,
): MaterializationJournal.MaterializationRecord | undefined => {
  const statement = sql`SELECT * FROM ${MATERIALIZATION_JOURNAL_META_TABLE}
    WHERE seqNumGlobal = $global
      AND seqNumClient = $client
      AND seqNumRebaseGeneration = $rebaseGeneration
    LIMIT 1`
  const row = dbState.select<MaterializationJournalMetaRow>(
    statement,
    prepareBindValues(
      {
        global: key.global,
        client: key.client,
        rebaseGeneration: key.rebaseGeneration,
      },
      statement,
    ),
  )[0]

  if (row === undefined) return undefined

  return {
    key,
    changeset: row.changeset,
  }
}

const captureChangeset = (dbState: SqliteDb, mutation: () => void): Uint8Array<ArrayBuffer> => {
  const session = dbState.session()

  try {
    mutation()
    const changeset = session.changeset()
    if (changeset === null) {
      throw new Error('Expected mutation to produce a SQLite changeset')
    }
    return changeset
  } finally {
    session.finish()
  }
}
