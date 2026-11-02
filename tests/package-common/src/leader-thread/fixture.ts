import {
  EventlogSqliteDb,
  MATERIALIZATION_JOURNAL_META_TABLE,
  MaterializationJournal,
  type SqliteDb,
  sql,
  StateHead,
  StateSqliteDb,
} from '@livestore/common'
import { type EventSequenceNumber, Events, makeSchema, State } from '@livestore/common/schema'
import { Effect, Layer, Schema } from '@livestore/utils/effect'

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
    deletedAt: State.SQLite.datetime({ default: null, nullable: true }),
  },
})

const Config = Schema.Struct({
  fontSize: Schema.Finite,
  theme: Schema.Literals(['light', 'dark']),
})

const appConfig = State.SQLite.clientDocument({
  name: 'app_config',
  schema: Config,
  default: { value: { fontSize: 16, theme: 'light' } },
})

const appConfigTable = appConfig as typeof appConfig & State.SQLite.ClientDocumentTableDef<any, any, any, any>

export const appConfigSetEvent = appConfigTable[State.SQLite.ClientDocumentTableDefSymbol].derived.setEventDef

export const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
  todoCompleted: Events.synced({
    name: 'todoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeletedNonPure: Events.synced({
    name: 'todoDeletedNonPure',
    schema: Schema.Struct({ id: Schema.String }),
  }),
}

/** Advanced on every read, like a clock, so leader and session never compute the same non-pure result. */
let nonPureClock = 0

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }) => todos.insert({ id, text, completed: completed ?? false }),
  todoCompleted: ({ id }) => todos.update({ completed: true }).where({ id }),
  // Non-pure: reading the clock is a side effect. A counter keeps it distinct regardless of timer resolution.
  todoDeletedNonPure: ({ id }) => todos.update({ deletedAt: new Date(++nonPureClock) }).where({ id }),
})

export const tables = { todos, appConfig }

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ state, events })

/** Provides the role-specific SQLite handles plus the state services derived from them, as adapters do. */
export const makeSqliteServicesLayer = ({ dbState, dbEventlog }: { dbState: SqliteDb; dbEventlog: SqliteDb }) => {
  const sqliteDbLayer = Layer.mergeAll(StateSqliteDb.layer(dbState), EventlogSqliteDb.layer(dbEventlog))
  const stateServicesLayer = Layer.mergeAll(StateHead.layer, MaterializationJournal.layer).pipe(
    Layer.provide(sqliteDbLayer),
  )
  return Layer.mergeAll(sqliteDbLayer, stateServicesLayer)
}

/** Reads the persisted state head of a state database. */
export const getStateHead = (dbState: SqliteDb) =>
  StateHead.make.pipe(
    Effect.provideService(StateSqliteDb.StateSqliteDb, dbState),
    Effect.flatMap((stateHead) => stateHead.get),
  )

/** Returns the journaled changeset for `key`: `undefined` without a row, `null` for a recorded no-op. */
export const getJournalChangeset = (dbState: SqliteDb, key: EventSequenceNumber.Client.Composite) =>
  dbState.select<{ changeset: Uint8Array<ArrayBuffer> | null }>(
    sql`SELECT changeset FROM ${MATERIALIZATION_JOURNAL_META_TABLE}
        WHERE seqNumGlobal = ${key.global}
          AND seqNumClient = ${key.client}
          AND seqNumRebaseGeneration = ${key.rebaseGeneration}
        LIMIT 1`,
  )[0]?.changeset
