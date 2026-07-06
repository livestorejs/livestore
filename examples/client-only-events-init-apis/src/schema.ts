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
  threadListUi: State.SQLite.table({
    name: 'threadListUi',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      selectedThreadId: State.SQLite.text({ nullable: true }),
      sortBy: State.SQLite.text({ schema: Schema.Literal('receivedAt') }),
      sortDirection: State.SQLite.text({ schema: SortDirection }),
    },
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
  threadListUiEnsured: Events.clientOnly({
    name: 'v1.ThreadListUiEnsured',
    schema: Schema.Struct({
      id: Schema.String,
      selectedThreadId: Schema.NullOr(Schema.String),
      sortBy: Schema.Literal('receivedAt'),
      sortDirection: SortDirection,
    }),
  }),
  threadListSortDirectionChanged: Events.clientOnly({
    name: 'v1.ThreadListSortDirectionChanged',
    schema: Schema.Struct({
      id: Schema.String,
      sortDirection: SortDirection,
    }),
  }),
  threadListThreadSelected: Events.clientOnly({
    name: 'v1.ThreadListThreadSelected',
    schema: Schema.Struct({
      id: Schema.String,
      selectedThreadId: Schema.NullOr(Schema.String),
    }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  'v1.ThreadSynced': ({ id, mailboxId, subject, receivedAt }) =>
    tables.threads.insert({ id, mailboxId, subject, receivedAt }).onConflict('id', 'replace'),
  'v1.ThreadListUiEnsured': ({ id, selectedThreadId, sortBy, sortDirection }) =>
    tables.threadListUi.insert({ id, selectedThreadId, sortBy, sortDirection }).onConflict('id', 'ignore'),
  'v1.ThreadListSortDirectionChanged': ({ id, sortDirection }) =>
    tables.threadListUi.update({ sortDirection }).where({ id }),
  'v1.ThreadListThreadSelected': ({ id, selectedThreadId }) =>
    tables.threadListUi.update({ selectedThreadId }).where({ id }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
