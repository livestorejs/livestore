import { Schema } from '@livestore/utils/effect'
import { type SqliteAst as __SqliteAst, SqliteDsl } from 'effect-db-schema'

import { mutationEventRootIdSchema } from './mutations.js'
import type { FromTable } from './table-def.js'
import { table } from './table-def.js'

/// App DB

export const SCHEMA_META_TABLE = '__livestore_schema'

export const schemaMetaTable = table(
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

export const schemaMutationsMetaTable = table(
  SCHEMA_MUTATIONS_META_TABLE,
  {
    mutationName: SqliteDsl.text({ primaryKey: true }),
    schemaHash: SqliteDsl.integer({ nullable: false }),
    /** ISO date format */
    updatedAt: SqliteDsl.text({ nullable: false }),
  },
  { disableAutomaticIdColumn: true },
)

export type SchemaMutationsMetaRow = FromTable.RowDecoded<typeof schemaMutationsMetaTable>

export const systemTables = [schemaMetaTable, schemaMutationsMetaTable]

/// Mutation log DB

export const SyncStatus = Schema.Literal('synced', 'pending', 'error', 'localOnly')
export type SyncStatus = typeof SyncStatus.Type

export const MUTATION_LOG_META_TABLE = 'mutation_log'

export const mutationLogMetaTable = table(
  MUTATION_LOG_META_TABLE,
  {
    id: SqliteDsl.text({ primaryKey: true }),
    parentId: SqliteDsl.text({ schema: Schema.Union(Schema.String, mutationEventRootIdSchema) }),
    mutation: SqliteDsl.text({}),
    argsJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Any) }),
    schemaHash: SqliteDsl.integer({}),
    /** Local only, used for ordered queries to avoid recursive id traversal */
    orderKey: SqliteDsl.integer({}),
    /** ISO date format */
    createdAt: SqliteDsl.text({}),
    syncStatus: SqliteDsl.text({ schema: SyncStatus }),
    syncMetadataJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Option(Schema.JsonValue)) }),
  },
  { disableAutomaticIdColumn: true, indexes: [{ columns: ['orderKey'], name: 'mutation_log_order_key_idx' }] },
)

export type MutationLogMetaRow = FromTable.RowDecoded<typeof mutationLogMetaTable>
