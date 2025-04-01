import { Schema } from '@livestore/utils/effect'

import { SqliteDsl } from './db-schema/mod.js'
import * as EventId from './EventId.js'
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

/**
 * Table which stores SQLite changeset blobs which is used for rolling back
 * read-model state during rebasing.
 */
export const SESSION_CHANGESET_META_TABLE = '__livestore_session_changeset'

export const sessionChangesetMetaTable = table(
  SESSION_CHANGESET_META_TABLE,
  {
    // TODO bring back primary key
    idGlobal: SqliteDsl.integer({ schema: EventId.GlobalEventId }),
    idClient: SqliteDsl.integer({ schema: EventId.ClientEventId }),
    changeset: SqliteDsl.blob({ nullable: true }),
    debug: SqliteDsl.json({ nullable: true }),
  },
  {
    disableAutomaticIdColumn: true,
    indexes: [{ columns: ['idGlobal', 'idClient'], name: 'idx_session_changeset_id' }],
  },
)

export type SessionChangesetMetaRow = FromTable.RowDecoded<typeof sessionChangesetMetaTable>

export const systemTables = [schemaMetaTable, schemaMutationsMetaTable, sessionChangesetMetaTable]

/// Mutation log DB

export const SyncStatus = Schema.Literal('synced', 'pending', 'error', 'clientOnly')
export type SyncStatus = typeof SyncStatus.Type

export const MUTATION_LOG_META_TABLE = 'mutation_log'

export const mutationLogMetaTable = table(
  MUTATION_LOG_META_TABLE,
  {
    // Adjust modeling so a global event never needs a client id component
    idGlobal: SqliteDsl.integer({ primaryKey: true, schema: EventId.GlobalEventId }),
    idClient: SqliteDsl.integer({ primaryKey: true, schema: EventId.ClientEventId }),
    parentIdGlobal: SqliteDsl.integer({ schema: EventId.GlobalEventId }),
    parentIdClient: SqliteDsl.integer({ schema: EventId.ClientEventId }),
    mutation: SqliteDsl.text({}),
    argsJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Any) }),
    clientId: SqliteDsl.text({}),
    sessionId: SqliteDsl.text({}),
    schemaHash: SqliteDsl.integer({}),
    syncMetadataJson: SqliteDsl.text({ schema: Schema.parseJson(Schema.Option(Schema.JsonValue)) }),
  },
  {
    disableAutomaticIdColumn: true,
    indexes: [
      { columns: ['idGlobal'], name: 'idx_idGlobal' },
      { columns: ['idGlobal', 'idClient'], name: 'idx_mutationlog_id' },
    ],
  },
)

export type MutationLogMetaRow = FromTable.RowDecoded<typeof mutationLogMetaTable>

export const SYNC_STATUS_TABLE = '__livestore_sync_status'

export const syncStatusTable = table(
  SYNC_STATUS_TABLE,
  {
    head: SqliteDsl.integer({ primaryKey: true }),
  },
  { disableAutomaticIdColumn: true },
)

export type SyncStatusRow = FromTable.RowDecoded<typeof syncStatusTable>
