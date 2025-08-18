import { EventSequenceNumber, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

export const eventlogTable = State.SQLite.table({
  // NOTE actual table name is determined at runtime
  name: 'eventlog_$PERSISTENCE_FORMAT_VERSION_$storeId',
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

/** Will only ever have one row per durable object. */
export const contextTable = State.SQLite.table({
  name: 'context',
  columns: {
    storeId: State.SQLite.text({ primaryKey: true }),
    currentHead: State.SQLite.integer({ schema: EventSequenceNumber.GlobalEventSequenceNumber }),
  },
})
