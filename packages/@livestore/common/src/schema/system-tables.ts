// import { Schema as __Schema } from '@livestore/utils/effect'
import { type SqliteAst as __SqliteAst, SqliteDsl } from 'effect-db-schema'

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

export const SCHEMA_MUTATIONS_META_TABLE = '__livestore_schema_mutations'

const schemaMutationsMetaTable = table(
  SCHEMA_MUTATIONS_META_TABLE,
  {
    mutationName: SqliteDsl.text({ primaryKey: true }),
    schemaHash: SqliteDsl.integer({ nullable: false }),
    // TODO remove jsonSchemaStr again
    jsonSchemaStr: SqliteDsl.text({ nullable: false }),
    /** ISO date format */
    updatedAt: SqliteDsl.text({ nullable: false }),
  },
  { disableAutomaticIdColumn: true },
)

export type SchemaMutationsMetaRow = FromTable.RowDecoded<typeof schemaMutationsMetaTable>

export const systemTables = [schemaMetaTable, schemaMutationsMetaTable]
