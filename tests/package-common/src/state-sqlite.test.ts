import { type MakeSqliteDb, migrateTable, sql } from '@livestore/common'
import { State } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect, Schema } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

Vitest.describe('SQLite State', () => {
  Vitest.describe('DB Schema', () => {
    const setup = (tableDef: State.SQLite.TableDef.Any) =>
      Effect.gen(function* () {
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
          Effect.withSpan('@livestore/adapter-node:leader-thread:loadSqlite3Wasm'),
        )

        const makeSqliteDb = (yield* sqliteDbFactory({ sqlite3 })) as MakeSqliteDb

        const db = yield* makeSqliteDb({ _tag: 'in-memory' })

        yield* migrateTable({
          db,
          tableAst: tableDef.sqliteDef.ast,
          behaviour: 'drop-and-recreate',
          skipMetaTable: true,
        })

        return db
      })

    Vitest.scopedLive(
      'should work for nullable json fields with default null',
      Effect.fn(function* () {
        const testTable = State.SQLite.table({
          name: 'test',
          columns: {
            id: State.SQLite.integer({ primaryKey: true }),
            json: State.SQLite.json({ default: null, nullable: true }),
          },
        })

        const db = yield* setup(testTable)

        db.execute(sql`insert into test (id) values (1)`)

        const rawResult = db.select(sql`select * from test`)
        expect(rawResult).toEqual([{ id: 1, json: null }])

        const result = Schema.decodeUnknownSync(testTable.rowSchema.pipe(Schema.Array, Schema.headOrElse()))(rawResult)

        expect(result).toEqual({ id: 1, json: null })
      }, Effect.provide(PlatformNode.NodeFileSystem.layer)),
    )

    // Probably a very unlikely scenario but hey 🤷
    Vitest.scopedLive(
      'should work for nullable json fields with default "null" as a string',
      Effect.fn(function* () {
        const testTable = State.SQLite.table({
          name: 'test',
          columns: {
            id: State.SQLite.integer({ primaryKey: true }),
            json: State.SQLite.json({ default: 'null', nullable: true }),
          },
        })

        const db = yield* setup(testTable)

        db.execute(sql`insert into test (id) values (1)`)

        const rawResult = db.select(sql`select * from test`)
        expect(rawResult).toEqual([{ id: 1, json: '"null"' }])

        const result = Schema.decodeUnknownSync(testTable.rowSchema.pipe(Schema.Array, Schema.headOrElse()))(rawResult)

        expect(result).toEqual({ id: 1, json: 'null' })
      }, Effect.provide(PlatformNode.NodeFileSystem.layer)),
    )
  })
})
