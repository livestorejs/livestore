import { EventSequenceNumber, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import { PERSISTENCE_FORMAT_VERSION } from '../shared.ts'

/**
 * Main event log table storing all LiveStore events.
 *
 * ⚠️  IMPORTANT: Any changes to this schema require bumping PERSISTENCE_FORMAT_VERSION in shared.ts
 */
export const eventlogTable = State.SQLite.table({
  // NOTE actual table name is determined at runtime to use proper storeId
  name: `eventlog_${PERSISTENCE_FORMAT_VERSION}_$storeId`,
  columns: {
    seqNum: State.SQLite.integer({ primaryKey: true, schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    parentSeqNum: State.SQLite.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    name: State.SQLite.text({}),
    args: State.SQLite.text({ schema: Schema.parseJson(Schema.Any), nullable: true }),
    /** ISO date format. Currently only used for debugging purposes. */
    createdAt: State.SQLite.text({}),
    clientId: State.SQLite.text({}),
    sessionId: State.SQLite.text({}),
  },
})

/**
 * Context metadata table - one row per durable object.
 *
 * ⚠️  IMPORTANT: Any changes to this schema require bumping PERSISTENCE_FORMAT_VERSION in shared.ts
 */
export const contextTable = State.SQLite.table({
  name: `context_${PERSISTENCE_FORMAT_VERSION}`,
  columns: {
    storeId: State.SQLite.text({ primaryKey: true }),
    currentHead: State.SQLite.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
    backendId: State.SQLite.text({}),
  },
})
