import { Option, Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import type { SqliteAst } from '../schema/state/sqlite/db-schema/mod.ts'
import { makeColumnSpec } from './migrations.js'

const createColumn = (
  name: string,
  type: 'text' | 'integer',
  options: { nullable?: boolean; primaryKey?: boolean } = {},
) => ({
  _tag: 'column' as const,
  name,
  type: { _tag: type },
  nullable: options.nullable ?? true,
  primaryKey: options.primaryKey ?? false,
  default: Option.none(),
  schema: type === 'text' ? Schema.String : Schema.Number,
})

describe('makeColumnSpec', () => {
  it('should quote column names properly for reserved keywords', () => {
    const table: SqliteAst.Table = {
      _tag: 'table',
      name: 'blocks',
      columns: [createColumn('order', 'integer', { nullable: false }), createColumn('group', 'text')],
      indexes: [],
    }

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(`"'order' integer not null , 'group' text  "`)
    expect(result).toContain("'order'")
    expect(result).toContain("'group'")
  })

  it('should handle basic columns with primary keys', () => {
    const table: SqliteAst.Table = {
      _tag: 'table',
      name: 'users',
      columns: [createColumn('id', 'text', { nullable: false, primaryKey: true }), createColumn('name', 'text')],
      indexes: [],
    }

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(`"'id' text not null , 'name' text  , PRIMARY KEY ('id')"`)
    expect(result).toContain("PRIMARY KEY ('id')")
  })

  it('should handle multi-column primary keys', () => {
    const table: SqliteAst.Table = {
      _tag: 'table',
      name: 'composite',
      columns: [
        createColumn('tenant_id', 'text', { nullable: false, primaryKey: true }),
        createColumn('user_id', 'text', { nullable: false, primaryKey: true }),
      ],
      indexes: [],
    }

    const result = makeColumnSpec(table)
    expect(result).toMatchInlineSnapshot(
      `"'tenant_id' text not null , 'user_id' text not null , PRIMARY KEY ('tenant_id', 'user_id')"`,
    )
    expect(result).toContain("PRIMARY KEY ('tenant_id', 'user_id')")
  })
})
