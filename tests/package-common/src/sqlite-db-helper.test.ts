import { SqliteDbHelper } from '@livestore/common'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Deferred, Effect, Fiber } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const setup = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  const db = yield* makeSqliteDb({ _tag: 'in-memory' })

  db.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')

  return { db }
})

Vitest.describe.concurrent('SqliteDbHelper', () => {
  Vitest.scopedLive('withSavepointSync commits successful changes', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup

      SqliteDbHelper.withSavepointSync({
        db,
        savepointName: 'test_savepoint',
        fn: () => {
          db.execute("INSERT INTO test (id, value) VALUES (1, 'committed')")
        },
      })

      const rows = db.select<{ value: string }>('SELECT value FROM test')
      expect(rows).toEqual([{ value: 'committed' }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('withSavepointSync rolls back failed changes', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup

      expect(() =>
        SqliteDbHelper.withSavepointSync({
          db,
          savepointName: 'test_savepoint',
          fn: () => {
            db.execute("INSERT INTO test (id, value) VALUES (1, 'rolled-back')")
            throw new Error('rollback')
          },
        }),
      ).toThrow('rollback')

      const rows = db.select<{ value: string }>('SELECT value FROM test')
      expect(rows).toEqual([])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('withSavepoint rolls back failed effects', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup

      const exit = yield* SqliteDbHelper.withSavepoint({
        db,
        savepointName: 'test_savepoint',
        effect: Effect.gen(function* () {
          db.execute("INSERT INTO test (id, value) VALUES (1, 'rolled-back')")
          return yield* Effect.fail('rollback')
        }),
      }).pipe(Effect.exit)

      expect(exit._tag).toEqual('Failure')

      const rows = db.select<{ value: string }>('SELECT value FROM test')
      expect(rows).toEqual([])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('withSavepoint composes inside an outer transaction', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup

      db.execute('BEGIN TRANSACTION')

      db.execute("INSERT INTO test (id, value) VALUES (1, 'outer')")

      yield* SqliteDbHelper.withSavepoint({
        db,
        savepointName: 'inner_savepoint',
        effect: Effect.sync(() => {
          db.execute("INSERT INTO test (id, value) VALUES (2, 'inner')")
        }),
      })

      expect(() =>
        SqliteDbHelper.withSavepointSync({
          db,
          savepointName: 'failing_inner_savepoint',
          fn: () => {
            db.execute("INSERT INTO test (id, value) VALUES (3, 'rolled-back')")
            throw new Error('rollback inner')
          },
        }),
      ).toThrow('rollback inner')

      db.execute('COMMIT')

      const rows = db.select<{ id: number; value: string }>('SELECT id, value FROM test ORDER BY id ASC')
      expect(rows).toEqual([
        { id: 1, value: 'outer' },
        { id: 2, value: 'inner' },
      ])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.scopedLive('withSavepoint rolls back and releases on interruption', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup
      const started = yield* Deferred.make<void>()

      const fiber = yield* SqliteDbHelper.withSavepoint({
        db,
        savepointName: 'interrupted_savepoint',
        effect: Effect.gen(function* () {
          db.execute("INSERT INTO test (id, value) VALUES (1, 'interrupted')")
          yield* Deferred.succeed(started, undefined)
          yield* Effect.never
        }),
      }).pipe(Effect.fork)

      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)

      const rows = db.select<{ value: string }>('SELECT value FROM test')
      expect(rows).toEqual([])

      db.execute("INSERT INTO test (id, value) VALUES (2, 'after-interrupt')")
      const rowsAfterInterrupt = db.select<{ value: string }>('SELECT value FROM test')
      expect(rowsAfterInterrupt).toEqual([{ value: 'after-interrupt' }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
})
