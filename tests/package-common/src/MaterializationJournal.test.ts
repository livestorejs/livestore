import { expect } from 'vitest'

import { MaterializationJournal, migrateDb } from '@livestore/common'
import type { SqliteDb } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Exit, Option } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { schema as fixtureSchema } from './leader-thread/fixture.ts'

const key = (global: number, client = 0, rebaseGeneration = 0) =>
  EventSequenceNumber.Client.Composite.make({ global, client, rebaseGeneration })

const changeset = (value: number): MaterializationJournal.MaterializationChangeset => ({
  _tag: 'sessionChangeset',
  data: Uint8Array.from([value]),
})

type TestJournal = {
  journal: MaterializationJournal.MaterializationJournalService
  rollbackOrder: number[]
  dbState?: SqliteDb
}

const implementations = [
  {
    name: 'memory',
    make: Effect.sync((): TestJournal => {
      const rollbackOrder: number[] = []
      return {
        rollbackOrder,
        journal: MaterializationJournal.makeMemory({
          rollback: (data) => rollbackOrder.push(data[0]!),
        }),
      }
    }),
  },
  {
    name: 'sqlite',
    make: Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
      yield* migrateDb({ db: dbState, schema: fixtureSchema })
      return { journal: MaterializationJournal.make({ dbState }), rollbackOrder: [], dbState } satisfies TestJournal
    }),
  },
] as const

for (const implementation of implementations) {
  Vitest.describe.concurrent(`MaterializationJournal (${implementation.name})`, () => {
    Vitest.live('records and gets changesets and no-op entries', (test) =>
      Effect.gen(function* () {
        const { journal } = yield* implementation.make
        const changesetRecord = { key: key(1), changeset: changeset(11) } as const
        const noOpRecord = { key: key(2), changeset: { _tag: 'no-op' as const } } as const

        yield* journal.record(changesetRecord)
        yield* journal.record(noOpRecord)

        expect(Option.getOrThrow(yield* journal.get(changesetRecord.key))).toEqual(changesetRecord)
        expect(Option.getOrThrow(yield* journal.get(noOpRecord.key))).toEqual(noOpRecord)
      }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
    )

    Vitest.live('replaces an existing record with the same full key', (test) =>
      Effect.gen(function* () {
        const { journal } = yield* implementation.make
        const recordKey = key(1, 2, 3)

        yield* journal.record({ key: recordKey, changeset: changeset(1) })
        yield* journal.record({ key: recordKey, changeset: changeset(2) })

        expect(Option.getOrThrow(yield* journal.get(recordKey)).changeset).toEqual(changeset(2))
      }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
    )

    Vitest.live('remove matches the exact rebase generation', (test) =>
      Effect.gen(function* () {
        const { journal } = yield* implementation.make
        const firstGeneration = key(1, 1, 0)
        const secondGeneration = key(1, 1, 1)
        yield* journal.record({ key: firstGeneration, changeset: { _tag: 'no-op' } })
        yield* journal.record({ key: secondGeneration, changeset: { _tag: 'no-op' } })

        yield* journal.remove([firstGeneration])

        expect(Option.isNone(yield* journal.get(firstGeneration))).toBe(true)
        expect(Option.isSome(yield* journal.get(secondGeneration))).toBe(true)
      }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
    )

    Vitest.live('removeThrough removes records inclusively while ignoring rebase generation', (test) =>
      Effect.gen(function* () {
        const { journal } = yield* implementation.make
        const removed = [key(1, 0, 0), key(2, 0, 7), key(2, 1, 1)]
        const retained = [key(2, 2, 0), key(3, 0, 0)]
        for (const recordKey of [...removed, ...retained]) {
          yield* journal.record({ key: recordKey, changeset: { _tag: 'no-op' } })
        }

        yield* journal.removeThrough(key(2, 1, 0))

        for (const recordKey of removed) expect(Option.isNone(yield* journal.get(recordKey))).toBe(true)
        for (const recordKey of retained) expect(Option.isSome(yield* journal.get(recordKey))).toBe(true)
      }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
    )

    Vitest.live('empty rollback and removal are no-ops', (test) =>
      Effect.gen(function* () {
        const { journal } = yield* implementation.make

        yield* journal.rollback([])
        yield* journal.remove([])
      }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
    )

    Vitest.live('remove chunks more than 100 keys', (test) =>
      Effect.gen(function* () {
        const { journal } = yield* implementation.make
        const keys = Array.from({ length: 205 }, (_, index) => key(index + 1, index % 3, index % 2))
        for (const recordKey of keys) {
          yield* journal.record({ key: recordKey, changeset: { _tag: 'no-op' } })
        }

        yield* journal.remove(keys)

        for (const recordKey of keys) expect(Option.isNone(yield* journal.get(recordKey))).toBe(true)
      }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
    )

    Vitest.live('missing-key rollback is atomic', (test) =>
      Effect.gen(function* () {
        const { journal, rollbackOrder } = yield* implementation.make
        const existingKey = key(1)
        yield* journal.record({ key: existingKey, changeset: changeset(1) })

        const exit = yield* journal.rollback([existingKey, key(2)]).pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        expect(rollbackOrder).toEqual([])
        expect(Option.isSome(yield* journal.get(existingKey))).toBe(true)
      }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
    )
  })
}

Vitest.describe.concurrent('MaterializationJournal rollback', () => {
  Vitest.live('memory applies changesets in reverse sequence order and skips no-ops', (test) =>
    Effect.gen(function* () {
      const rollbackOrder: number[] = []
      const journal = MaterializationJournal.makeMemory({
        rollback: (data) => rollbackOrder.push(data[0]!),
      })
      yield* journal.record({ key: key(1), changeset: changeset(1) })
      yield* journal.record({ key: key(2), changeset: { _tag: 'no-op' } })
      yield* journal.record({ key: key(3), changeset: changeset(3) })

      yield* journal.rollback([key(1), key(3), key(2)])

      expect(rollbackOrder).toEqual([3, 1])
      expect(Option.isNone(yield* journal.get(key(1)))).toBe(true)
      expect(Option.isNone(yield* journal.get(key(2)))).toBe(true)
      expect(Option.isNone(yield* journal.get(key(3)))).toBe(true)
    }).pipe(Vitest.withTestCtx(test)),
  )

  Vitest.live('sqlite applies dependent changesets in reverse order', (test) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
      yield* migrateDb({ db: dbState, schema: fixtureSchema })
      dbState.execute('CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL) STRICT')
      dbState.execute('INSERT INTO counter (id, value) VALUES (1, 0)')
      const journal = MaterializationJournal.make({ dbState })

      for (const value of [1, 2, 3]) {
        const session = dbState.session()
        dbState.execute(`UPDATE counter SET value = ${value} WHERE id = 1`)
        const data = session.changeset()
        session.finish()
        if (data === undefined) throw new Error('Expected a SQLite session changeset')
        yield* journal.record({ key: key(value), changeset: { _tag: 'sessionChangeset', data } })
      }

      yield* journal.rollback([key(1), key(3), key(2)])

      expect(dbState.select<{ value: number }>('SELECT value FROM counter')).toEqual([{ value: 0 }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
})
