import { Events, makeSchema, Schema, State } from '@livestore/livestore'

export const SortDirection = Schema.Literal('asc', 'desc')
export type SortDirection = typeof SortDirection.Type

export const tables = {
  threads: State.SQLite.table({
    name: 'threads',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      mailboxId: State.SQLite.text({ nullable: false }),
      subject: State.SQLite.text({ nullable: false }),
      receivedAt: State.SQLite.integer({ nullable: false }),
    },
  }),
  sourceReady: State.SQLite.table({
    name: 'sourceReady',
    columns: {
      key: State.SQLite.text({ primaryKey: true }),
      revision: State.SQLite.integer({ nullable: false }),
    },
  }),
  threadListUi: State.SQLite.clientDocument({
    name: 'threadListUi',
    schema: Schema.Struct({
      selectedThreadId: Schema.NullOr(Schema.String),
      sortBy: Schema.Literal('receivedAt'),
      sortDirection: SortDirection,
    }),
    default: { value: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'asc' } },
  }),
}

export const events = {
  threadSynced: Events.synced({
    name: 'v1.ThreadSynced',
    schema: Schema.Struct({
      id: Schema.String,
      mailboxId: Schema.String,
      subject: Schema.String,
      receivedAt: Schema.Number,
    }),
  }),
  sourceReady: Events.synced({
    name: 'v1.SourceReady',
    schema: Schema.Struct({ key: Schema.String, revision: Schema.Number }),
  }),
  threadListUiSet: tables.threadListUi.set,
}

const materializers = State.SQLite.materializers(events, {
  'v1.ThreadSynced': ({ id, mailboxId, subject, receivedAt }) =>
    tables.threads.insert({ id, mailboxId, subject, receivedAt }).onConflict('id', 'replace'),
  'v1.SourceReady': ({ key, revision }) => tables.sourceReady.insert({ key, revision }).onConflict('key', 'replace'),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
