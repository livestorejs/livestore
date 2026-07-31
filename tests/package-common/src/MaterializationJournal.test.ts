import { expect } from 'vitest'

import {
  MATERIALIZATION_JOURNAL_META_TABLE,
  MaterializationJournal,
  migrateDb,
  prepareBindValues,
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
        changeset: { _tag: 'changeset', data: Uint8Array.from([1, 2, 3]) },
      })

      const replacementChangeset = Uint8Array.from([4, 5, 6])
      yield* journal.record({
        key,
        changeset: { _tag: 'changeset', data: replacementChangeset },
      })

      expect(getRecord(dbState, key)).toEqual({
        key,
        changeset: { _tag: 'changeset', data: replacementChangeset },
      })
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('discards records up to the confirmed head', (test) =>
    Effect.gen(function* () {
      const { dbState, journal } = yield* setup

      const confirmedKey = EventSequenceNumber.Client.Composite.make({ global: 1, client: 2, rebaseGeneration: 3 })
      yield* journal.record({ key: confirmedKey, changeset: { _tag: 'no-op' } })

      const rebasedConfirmedKey = EventSequenceNumber.Client.Composite.make({
        global: 1,
        client: 2,
        rebaseGeneration: 4,
      })
      yield* journal.record({ key: rebasedConfirmedKey, changeset: { _tag: 'no-op' } })

      const pendingKey = EventSequenceNumber.Client.Composite.make({ global: 1, client: 3, rebaseGeneration: 0 })
      yield* journal.record({ key: pendingKey, changeset: { _tag: 'no-op' } })

      yield* journal.discardUpTo(confirmedKey)

      expect(getRecord(dbState, confirmedKey)).toBeUndefined()
      expect(getRecord(dbState, rebasedConfirmedKey)).toBeUndefined()
      expect(getRecord(dbState, pendingKey)).toEqual({
        key: pendingKey,
        changeset: { _tag: 'no-op' },
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
        changeset: { _tag: 'changeset', data: insertChangeset },
      })

      const updateKey = EventSequenceNumber.Client.Composite.make({ global: 2, client: 0, rebaseGeneration: 0 })
      const updateChangeset = captureChangeset(dbState, () => {
        dbState.execute("UPDATE journal_test SET value = 'updated' WHERE id = 1")
      })
      yield* journal.record({
        key: updateKey,
        changeset: { _tag: 'changeset', data: updateChangeset },
      })

      const noOpKey = EventSequenceNumber.Client.Composite.make({ global: 3, client: 0, rebaseGeneration: 0 })
      yield* journal.record({ key: noOpKey, changeset: { _tag: 'no-op' } })

      yield* journal.rollback([insertKey, noOpKey, updateKey])

      expect(dbState.select('SELECT id, value FROM journal_test')).toEqual([])
      expect(getRecord(dbState, insertKey)).toBeUndefined()
      expect(getRecord(dbState, updateKey)).toBeUndefined()
      expect(getRecord(dbState, noOpKey)).toBeUndefined()
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('does not partially roll back when a requested record is missing', (test) =>
    Effect.gen(function* () {
      const { dbState, journal } = yield* setup

      const recordedKey = EventSequenceNumber.Client.Composite.make({ global: 2, client: 0, rebaseGeneration: 0 })
      const changeset = captureChangeset(dbState, () => {
        dbState.execute("INSERT INTO journal_test (id, value) VALUES (1, 'kept')")
      })
      yield* journal.record({
        key: recordedKey,
        changeset: { _tag: 'changeset', data: changeset },
      })

      const missingKey = EventSequenceNumber.Client.Composite.make({ global: 1, client: 0, rebaseGeneration: 0 })
      const error = yield* journal.rollback([recordedKey, missingKey]).pipe(Effect.flip)
      expect(error).toBeInstanceOf(MaterializationJournal.MaterializationJournalError)
      expect(error.method).toEqual('rollback')
      expect(error.cause).not.toBeInstanceOf(MaterializationJournal.MaterializationJournalError)

      expect(dbState.select('SELECT id, value FROM journal_test')).toEqual([{ id: 1, value: 'kept' }])
      expect(getRecord(dbState, recordedKey)).toEqual({
        key: recordedKey,
        changeset: { _tag: 'changeset', data: changeset },
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
    changeset: row.changeset === null ? { _tag: 'no-op' } : { _tag: 'changeset', data: row.changeset },
  }
}

const captureChangeset = (dbState: SqliteDb, mutation: () => void): Uint8Array<ArrayBuffer> => {
  const session = dbState.session()

  try {
    mutation()
    const changeset = session.changeset()
    if (changeset === undefined) {
      throw new Error('Expected mutation to produce a SQLite changeset')
    }
    return changeset
  } finally {
    session.finish()
  }
}
