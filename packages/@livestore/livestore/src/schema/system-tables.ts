import { SqliteAst as __SqliteAst, SqliteDsl } from 'effect-db-schema'

import type { FromTable } from './table-def.js'
import { table } from './table-def.js'

export const SCHEMA_META_TABLE = '__livestore_schema'

const schemaMetaTable = table(
  SCHEMA_META_TABLE,
  {
    tableName: SqliteDsl.text({ primaryKey: true }),
    schemaHash: SqliteDsl.integer({ nullable: false }),
    /** ISO date format */
    updatedAt: SqliteDsl.text({ nullable: false }),
  },
  { disableAutomaticIdColumn: true },
)

export type SchemaMetaRow = FromTable.RowDecoded<typeof schemaMetaTable>

export const systemTables = [schemaMetaTable]
