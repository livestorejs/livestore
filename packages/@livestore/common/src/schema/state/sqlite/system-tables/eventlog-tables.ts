import { Option, Schema, SchemaTransformation } from '@livestore/utils/effect'

import * as EventSequenceNumber from '../../../EventSequenceNumber/mod.ts'
import { SqliteDsl } from '../db-schema/mod.ts'
import { table } from '../table-def.ts'

/**
 * EVENTLOG DATABASE SYSTEM TABLES
 *
 * ⚠️  CRITICAL: NEVER modify eventlog schemas without bumping `liveStoreStorageFormatVersion`!
 * Eventlog is the source of truth - schema changes cause permanent data loss.
 *
 * TODO: Implement proper eventlog versioning system to prevent accidental data loss
 */

export const EVENTLOG_META_TABLE = 'eventlog'

const syncMetadataJson = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Option(Schema.JsonValue),
    SchemaTransformation.transform({
      decode: (value) => {
        const parsed = JSON.parse(value)

        if (parsed === null || parsed === undefined) return Option.none()
        if (typeof parsed === 'object' && parsed !== null && '_tag' in parsed) {
          if (parsed._tag === 'None') return Option.none()
          if (parsed._tag === 'Some' && 'value' in parsed) return Option.some(parsed.value as Schema.JsonValue)
        }

        return Option.some(parsed as Schema.JsonValue)
      },
      encode: (value) => JSON.stringify(Option.isSome(value) ? value.value : null),
    }),
  ),
)

/**
 * Main client-side event log storing all events (global and local/rebased).
 */
export const eventlogMetaTable = table({
  name: EVENTLOG_META_TABLE,
  columns: {
    // TODO Adjust modeling so a global event never needs a client id component
    seqNumGlobal: SqliteDsl.integer({ primaryKey: true, schema: EventSequenceNumber.Global.Schema }),
    seqNumClient: SqliteDsl.integer({ primaryKey: true, schema: EventSequenceNumber.Client.Schema }),
    seqNumRebaseGeneration: SqliteDsl.integer({ primaryKey: true }),
    parentSeqNumGlobal: SqliteDsl.integer({ schema: EventSequenceNumber.Global.Schema }),
    parentSeqNumClient: SqliteDsl.integer({ schema: EventSequenceNumber.Client.Schema }),
    parentSeqNumRebaseGeneration: SqliteDsl.integer({}),
    /** Event definition name */
    name: SqliteDsl.text({}),
    argsJson: SqliteDsl.text({ schema: Schema.fromJsonString(Schema.Any) }),
    clientId: SqliteDsl.text({}),
    sessionId: SqliteDsl.text({}),
    schemaHash: SqliteDsl.integer({}),
    syncMetadataJson: SqliteDsl.text({ schema: syncMetadataJson }),
  },
  indexes: [
    { columns: ['seqNumGlobal'], name: 'idx_eventlog_seqNumGlobal' },
    { columns: ['seqNumGlobal', 'seqNumClient', 'seqNumRebaseGeneration'], name: 'idx_eventlog_seqNum' },
  ],
})

export type EventlogMetaRow = typeof eventlogMetaTable.Type

export const SYNC_STATUS_TABLE = '__livestore_sync_status'

/**
 * Tracks sync status including the remote head position and backend identity.
 */
// TODO support sync backend identity (to detect if sync backend changes)
export const syncStatusTable = table({
  name: SYNC_STATUS_TABLE,
  columns: {
    head: SqliteDsl.integer({ primaryKey: true }),
    // Null means the sync backend is not yet connected and we haven't yet seen a backend ID
    backendId: SqliteDsl.text({ nullable: true }),
  },
})

export type SyncStatusRow = typeof syncStatusTable.Type

export const eventlogSystemTables = [eventlogMetaTable, syncStatusTable] as const
