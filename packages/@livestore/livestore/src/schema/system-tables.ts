import { SqliteAst as __SqliteAst, SqliteDsl } from 'effect-db-schema'

export const SCHEMA_META_TABLE = '__livestore_schema'

const schemaMetaTable = SqliteDsl.table(SCHEMA_META_TABLE, {
  tableName: SqliteDsl.text({ primaryKey: true }),
  schemaHash: SqliteDsl.integer({ nullable: false }),
  /** ISO date format */
  updatedAt: SqliteDsl.text({ nullable: false }),
})

export type SchemaMetaRow = SqliteDsl.FromTable.RowDecoded<typeof schemaMetaTable>

export const systemTables = [schemaMetaTable.ast]
