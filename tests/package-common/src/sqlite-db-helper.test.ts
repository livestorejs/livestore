import { expect } from 'vitest'

import { SqliteDbHelper, SqliteError } from '@livestore/common'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Deferred, Effect, Fiber } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

const setup = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  const db = yield* makeSqliteDb({ _tag: 'in-memory' })

  db.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')

  return { db, sqlite3 }
})

Vitest.describe('withSavepoint', () => {
  Vitest.live('rolls back failed effects', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup

      const exit = yield* SqliteDbHelper.withSavepoint(
        Effect.gen(function* () {
          db.execute("INSERT INTO test (id, value) VALUES (1, 'rolled-back')")
          return yield* Effect.fail('rollback')
        }),
        db,
      ).pipe(Effect.exit)

      expect(exit._tag).toEqual('Failure')

      const rows = db.select<{ value: string }>('SELECT value FROM test')
      expect(rows).toEqual([])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('returns SqliteError without cleanup when savepoint acquisition fails', (test) =>
    Effect.gen(function* () {
      const { db, sqlite3 } = yield* setup
      const savepointOperations: string[] = []
      let effectRan = false

      const SQLITE_OK = 0
      const SQLITE_DENY = 1
      const SQLITE_SAVEPOINT = 32
      sqlite3.set_authorizer(
        db.metadata.dbPointer,
        (_userData, actionCode, operation) => {
          if (actionCode === SQLITE_SAVEPOINT) {
            savepointOperations.push(operation ?? '')
            return SQLITE_DENY
          }

          return SQLITE_OK
        },
        undefined,
      )

      const error = yield* Effect.sync(() => {
        effectRan = true
      }).pipe(SqliteDbHelper.withSavepoint(db), Effect.flip)

      expect(error).toBeInstanceOf(SqliteError)
      expect(error.query?.sql).toMatch(/^SAVEPOINT livestore_savepoint_\d+$/)
      expect(effectRan).toBe(false)
      expect(savepointOperations).toEqual(['BEGIN'])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('returns SqliteError when releasing the savepoint fails', (test) =>
    Effect.gen(function* () {
      const { db, sqlite3 } = yield* setup

      const SQLITE_OK = 0
      const SQLITE_DENY = 1
      const SQLITE_SAVEPOINT = 32
      sqlite3.set_authorizer(
        db.metadata.dbPointer,
        (_userData, actionCode, operation) =>
          actionCode === SQLITE_SAVEPOINT && operation === 'RELEASE' ? SQLITE_DENY : SQLITE_OK,
        undefined,
      )

      const error = yield* Effect.void.pipe(SqliteDbHelper.withSavepoint(db), Effect.flip)

      expect(error).toBeInstanceOf(SqliteError)
      expect(error.query?.sql).toMatch(/^RELEASE SAVEPOINT livestore_savepoint_\d+$/)
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('returns SqliteError when rolling back to the savepoint fails', (test) =>
    Effect.gen(function* () {
      const { db, sqlite3 } = yield* setup

      const SQLITE_OK = 0
      const SQLITE_DENY = 1
      const SQLITE_SAVEPOINT = 32
      sqlite3.set_authorizer(
        db.metadata.dbPointer,
        (_userData, actionCode, operation) =>
          actionCode === SQLITE_SAVEPOINT && operation === 'ROLLBACK' ? SQLITE_DENY : SQLITE_OK,
        undefined,
      )

      const error = yield* Effect.fail('wrapped failure').pipe(SqliteDbHelper.withSavepoint(db), Effect.flip)

      expect(error).toBeInstanceOf(SqliteError)
      if (error instanceof SqliteError) {
        expect(error.query?.sql).toMatch(/^ROLLBACK TO SAVEPOINT livestore_savepoint_\d+$/)
      }
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('composes inside an outer transaction', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup

      db.execute('BEGIN TRANSACTION')

      db.execute("INSERT INTO test (id, value) VALUES (1, 'outer')")

      yield* Effect.sync(() => {
        db.execute("INSERT INTO test (id, value) VALUES (2, 'inner')")
      }).pipe(SqliteDbHelper.withSavepoint(db))

      yield* Effect.sync(() => {
        db.execute("INSERT INTO test (id, value) VALUES (3, 'rolled-back')")
      }).pipe(Effect.andThen(Effect.fail('rollback inner')), SqliteDbHelper.withSavepoint(db), Effect.ignore)

      db.execute('COMMIT')

      const rows = db.select<{ id: number; value: string }>('SELECT id, value FROM test ORDER BY id ASC')
      expect(rows).toEqual([
        { id: 1, value: 'outer' },
        { id: 2, value: 'inner' },
      ])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('rolls back and releases on interruption', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup
      const started = yield* Deferred.make<void>()

      const fiber = yield* Effect.gen(function* () {
        db.execute("INSERT INTO test (id, value) VALUES (1, 'interrupted')")
        yield* Deferred.succeed(started, undefined)
        return yield* Effect.never
      }).pipe(SqliteDbHelper.withSavepoint(db), Effect.forkScoped)

      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)

      const rows = db.select<{ value: string }>('SELECT value FROM test')
      expect(rows).toEqual([])

      db.execute("INSERT INTO test (id, value) VALUES (2, 'after-interrupt')")
      const rowsAfterInterrupt = db.select<{ value: string }>('SELECT value FROM test')
      expect(rowsAfterInterrupt).toEqual([{ value: 'after-interrupt' }])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('runs nested success and rollback branches synchronously', (test) =>
    Effect.gen(function* () {
      const { db } = yield* setup
      const context = yield* Effect.context()

      const result = yield* Effect.sync(() =>
        Effect.runSyncWith(context)(
          Effect.sync(() => {
            db.execute("INSERT INTO test (id, value) VALUES (1, 'outer-before')")
          }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                db.execute("INSERT INTO test (id, value) VALUES (2, 'inner-rolled-back')")
              }).pipe(Effect.andThen(Effect.fail('rollback inner')), SqliteDbHelper.withSavepoint(db), Effect.ignore),
            ),
            Effect.andThen(
              Effect.sync(() => {
                db.execute("INSERT INTO test (id, value) VALUES (3, 'outer-after')")
              }),
            ),
            SqliteDbHelper.withSavepoint(db),
            Effect.as('result'),
          ),
        ),
      )

      expect(result).toEqual('result')
      expect(db.select<{ id: number; value: string }>('SELECT id, value FROM test ORDER BY id ASC')).toEqual([
        { id: 1, value: 'outer-before' },
        { id: 3, value: 'outer-after' },
      ])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
})
