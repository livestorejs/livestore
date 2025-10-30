import { Option, Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import { makeColumnSpec } from './column-spec.ts'
import { SqliteAst } from './db-schema/mod.ts'

const createColumn = (
  name: string,
  type: 'text' | 'integer' | 'real' | 'blob',
  options: {
    nullable?: boolean
    primaryKey?: boolean
    autoIncrement?: boolean
    defaultValue?: unknown
    defaultSql?: string
  } = {},
): SqliteAst.Column => {
  let defaultOption: Option.Option<unknown> = Option.none()
  if (options.defaultSql !== undefined) {
    defaultOption = Option.some({ sql: options.defaultSql })
  } else if (options.defaultValue !== undefined) {
    defaultOption = Option.some(options.defaultValue)
  }

  const schema = (() => {
    switch (type) {
      case 'text':
        return Schema.String
      case 'integer':
        return options.defaultValue === true || options.defaultValue === false ? Schema.Boolean : Schema.Number
      case 'real':
        return Schema.Number
      case 'blob':
        return Schema.Uint8ArrayFromBase64
      default:
        return Schema.Unknown
    }
  })()

  return SqliteAst.column({
    name,
    type: { _tag: type },
    nullable: options.nullable ?? true,
    primaryKey: options.primaryKey ?? false,
    autoIncrement: options.autoIncrement ?? false,
    default: defaultOption,
    schema,
  })
}

describe('makeColumnSpec', () => {
  it('should quote column names properly for reserved keywords', () => {
    const table = SqliteAst.table(
      'blocks',
      [createColumn('order', 'integer', { nullable: false }), createColumn('group', 'text')],
      [],
    )

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(`""order" integer   not null , "group" text    "`)
    expect(result).toContain('"order"')
    expect(result).toContain('"group"')
  })

  it('should handle basic columns with primary keys', () => {
    const table = SqliteAst.table(
      'users',
      [createColumn('id', 'text', { nullable: false, primaryKey: true }), createColumn('name', 'text')],
      [],
    )

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(`""id" text primary key   , "name" text    "`)
  })

  it('should handle multi-column primary keys', () => {
    const table = SqliteAst.table(
      'composite',
      [
        createColumn('tenant_id', 'text', { nullable: false, primaryKey: true }),
        createColumn('user_id', 'text', { nullable: false, primaryKey: true }),
      ],
      [],
    )

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(
      `""tenant_id" text   not null , "user_id" text   not null , PRIMARY KEY ("tenant_id", "user_id")"`,
    )
    expect(result).toContain('PRIMARY KEY ("tenant_id", "user_id")')
  })

  it('should handle auto-increment columns', () => {
    const table = SqliteAst.table(
      'posts',
      [
        createColumn('id', 'integer', { nullable: false, primaryKey: true, autoIncrement: true }),
        createColumn('title', 'text'),
      ],
      [],
    )

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(`""id" integer primary key autoincrement  , "title" text    "`)
    expect(result).toContain('autoincrement')
    expect(result).not.toContain("PRIMARY KEY ('id')")
  })

  it('should handle columns with default values', () => {
    const table = SqliteAst.table(
      'products',
      [
        createColumn('id', 'integer', { nullable: false, primaryKey: true }),
        createColumn('name', 'text', { nullable: false }),
        createColumn('price', 'real', { defaultValue: 0 }),
        createColumn('active', 'integer', { defaultValue: true }),
        createColumn('description', 'text', { defaultValue: 'No description' }),
      ],
      [],
    )

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(
      `""id" integer primary key   , "name" text   not null , "price" real    default 0, "active" integer    default true, "description" text    default 'No description'"`,
    )
    expect(result).toContain('default 0')
    expect(result).toContain('default true')
    expect(result).toContain("default 'No description'")
  })

  it('should handle columns with SQL default values', () => {
    const table = SqliteAst.table(
      'logs',
      [
        createColumn('id', 'integer', { nullable: false, primaryKey: true }),
        createColumn('created_at', 'text', { defaultSql: 'CURRENT_TIMESTAMP' }),
        createColumn('random_value', 'real', { defaultSql: 'RANDOM()' }),
      ],
      [],
    )

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(
      `""id" integer primary key   , "created_at" text    default CURRENT_TIMESTAMP, "random_value" real    default RANDOM()"`,
    )
    expect(result).toContain('default CURRENT_TIMESTAMP')
    expect(result).toContain('default RANDOM()')
  })

  it('should handle null default values', () => {
    const table = SqliteAst.table(
      'nullable_defaults',
      [
        createColumn('id', 'integer', { nullable: false, primaryKey: true }),
        createColumn('optional_text', 'text', { defaultValue: null }),
      ],
      [],
    )

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(`""id" integer primary key   , "optional_text" text    default null"`)
    expect(result).toContain('default null')
  })

  it('should handle all column features combined', () => {
    const table = SqliteAst.table(
      'complex_table',
      [
        createColumn('id', 'integer', {
          nullable: false,
          primaryKey: true,
          autoIncrement: true,
        }),
        createColumn('name', 'text', {
          nullable: false,
          defaultValue: 'Unnamed',
        }),
        createColumn('created_at', 'text', {
          nullable: false,
          defaultSql: 'CURRENT_TIMESTAMP',
        }),
        createColumn('status', 'text', {
          defaultValue: 'pending',
        }),
      ],
      [],
    )

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(
      `""id" integer primary key autoincrement  , "name" text   not null default 'Unnamed', "created_at" text   not null default CURRENT_TIMESTAMP, "status" text    default 'pending'"`,
    )
  })

  it('should handle tables with indexes', () => {
    const table = SqliteAst.table(
      'users_with_indexes',
      [
        createColumn('id', 'integer', { nullable: false, primaryKey: true, autoIncrement: true }),
        createColumn('email', 'text', { nullable: false }),
        createColumn('username', 'text', { nullable: false }),
        createColumn('created_at', 'text', { defaultSql: 'CURRENT_TIMESTAMP' }),
      ],
      [
        SqliteAst.index(['email'], 'idx_users_email', true),
        SqliteAst.index(['username'], 'idx_users_username'),
        SqliteAst.index(['created_at'], 'idx_users_created_at'),
      ],
    )

    const result = makeColumnSpec(table)
    // The makeColumnSpec function only generates column specifications, not indexes
    expect(result).toMatchInlineSnapshot(
      `""id" integer primary key autoincrement  , "email" text   not null , "username" text   not null , "created_at" text    default CURRENT_TIMESTAMP"`,
    )
    // Verify the table has the indexes (even though they're not in the column spec)
    expect(table.indexes).toHaveLength(3)
    expect(table.indexes[0]!.unique).toBe(true)
    expect(table.indexes[1]!.unique).toBeUndefined()
  })
})
