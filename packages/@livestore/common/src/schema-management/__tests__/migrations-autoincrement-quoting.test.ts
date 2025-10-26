import { Effect, Option, Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import { SqliteAst } from '../../schema/state/sqlite/db-schema/mod.ts'
import type { PreparedStatement, SqliteDb } from '../../sqlite-types.ts'
import type { PreparedBindValues } from '../../util.ts'
import { migrateTable } from '../migrations.ts'

const makeStubDb = () => {
  const executed: string[] = []

  const db: SqliteDb = {
    _tag: 'SqliteDb',
    metadata: { dbPointer: 0, persistenceInfo: { fileName: ':memory:' } } as any,
    debug: { head: 0 as any },
    prepare: (queryStr: string): PreparedStatement => ({
      sql: queryStr,
      execute: (_bind: PreparedBindValues | undefined) => {
        executed.push(queryStr)
      },
      select: <T>(_bind: PreparedBindValues | undefined) => [] as unknown as ReadonlyArray<T>,
      finalize: () => {},
    }),
    execute: () => {},
    select: () => [],
    export: () => new Uint8Array(),
    import: () => {},
    close: () => {},
    destroy: () => {},
    session: () => ({ changeset: () => undefined, finish: () => {} }),
    makeChangeset: () => ({ invert: () => ({ invert: () => ({}) as any, apply: () => {} }) as any, apply: () => {} }),
  }

  return { db, executed }
}

describe('migrateTable - quoting and autoincrement', () => {
  it('creates valid CREATE TABLE with inline INTEGER PRIMARY KEY AUTOINCREMENT and double-quoted identifiers', () => {
    const { db, executed } = makeStubDb()

    const table = SqliteAst.table(
      'todos',
      [
        SqliteAst.column({
          name: 'id',
          type: { _tag: 'integer' },
          nullable: false,
          primaryKey: true,
          autoIncrement: true,
          default: Option.none(),
          schema: Schema.Number,
        }),
        SqliteAst.column({
          name: 'text',
          type: { _tag: 'text' },
          nullable: false,
          primaryKey: false,
          autoIncrement: false,
          default: Option.some(''),
          schema: Schema.String,
        }),
        SqliteAst.column({
          name: 'completed',
          type: { _tag: 'integer' },
          nullable: false,
          primaryKey: false,
          autoIncrement: false,
          default: Option.some(0),
          schema: Schema.Number,
        }),
      ],
      [],
    )

    migrateTable({ db, tableAst: table, behaviour: 'create-if-not-exists', skipMetaTable: true }).pipe(Effect.runSync)

    const createStmt = executed.find((s) => /create table if not exists/i.test(s))
    expect(createStmt).toBeDefined()

    // Identifiers must be double-quoted, not single-quoted
    expect(createStmt!).toContain('create table if not exists "todos"')
    expect(createStmt!).toContain('"id" integer primary key autoincrement')
    expect(createStmt!).toContain(" default ''")
    expect(createStmt!).not.toContain("PRIMARY KEY ('id')")
    expect(createStmt!).not.toMatch(/'todos'|'id'|'text'/)
  })
})
