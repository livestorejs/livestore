import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

export const mailboxTables = {
  labels: State.SQLite.table({
    name: 'labels',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      type: State.SQLite.text(), // 'system' | 'user'
      color: State.SQLite.text({ nullable: true }),
      threadCount: State.SQLite.integer({ default: 0 }),
      displayOrder: State.SQLite.integer({ default: 0 }), // Display order in UI
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),

  // Thread index - projection of thread metadata from Thread stores
  // Allows efficient querying and filtering of threads without loading full Thread stores
  threadIndex: State.SQLite.table({
    name: 'threadIndex',
    columns: {
      id: State.SQLite.text({ primaryKey: true }), // threadId
      subject: State.SQLite.text(),
      participants: State.SQLite.text(), // JSON array of email addresses
      lastActivity: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),

  // Thread-label associations - projection from Thread stores
  // Synchronized copy for efficient filtering (e.g., "show threads with label X")
  threadLabels: State.SQLite.table({
    name: 'threadLabels',
    columns: {
      threadId: State.SQLite.text(),
      labelId: State.SQLite.text(),
      appliedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),

  // Client-only UI state
  uiState: State.SQLite.clientDocument({
    name: 'uiState',
    schema: Schema.Struct({
      selectedThreadId: Schema.String.pipe(Schema.NullOr),
      selectedLabelId: Schema.String.pipe(Schema.NullOr),
    }),
    default: {
      id: SessionIdSymbol,
      value: {
        selectedThreadId: null,
        selectedLabelId: null,
      },
    },
  }),
}

export const mailboxEvents = {
  // System label creation (happens during seed/initialization)
  labelCreated: Events.synced({
    name: 'v1.LabelCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      type: Schema.Literal('system', 'user'),
      color: Schema.String.pipe(Schema.NullOr),
      displayOrder: Schema.Number,
      createdAt: Schema.Date,
    }),
  }),

  // Thread added to mailbox (projection from Thread store)
  threadAdded: Events.synced({
    name: 'v1.ThreadAdded',
    schema: Schema.Struct({
      id: Schema.String,
      subject: Schema.String,
      participants: Schema.Array(Schema.String), // Array of email addresses
      createdAt: Schema.Date,
    }),
  }),

  // Thread-label association applied (projection from Thread store)
  threadLabelApplied: Events.synced({
    name: 'v1.ThreadLabelApplied',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      appliedAt: Schema.Date,
    }),
  }),

  // Thread-label association removed (projection from Thread store)
  threadLabelRemoved: Events.synced({
    name: 'v1.ThreadLabelRemoved',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      removedAt: Schema.Date,
    }),
  }),

  // UI state events (client-only)
  uiStateSet: mailboxTables.uiState.set,
}

const materializers = State.SQLite.materializers(mailboxEvents, {
  'v1.LabelCreated': ({ id, name, type, color, displayOrder, createdAt }) =>
    mailboxTables.labels.insert({ id, name, type, color, displayOrder, threadCount: 0, createdAt }),

  'v1.ThreadAdded': ({ id, subject, participants, createdAt }) =>
    mailboxTables.threadIndex.insert({
      id,
      subject,
      participants: JSON.stringify(participants),
      lastActivity: createdAt,
      createdAt,
    }),

  'v1.ThreadLabelApplied': ({ threadId, labelId, appliedAt }) => [
    mailboxTables.threadLabels.insert({ threadId, labelId, appliedAt }),
    { sql: 'UPDATE labels SET threadCount = threadCount + 1 WHERE id = ?', bindValues: [labelId] },
  ],

  'v1.ThreadLabelRemoved': ({ threadId, labelId }) => [
    mailboxTables.threadLabels.delete().where({ threadId, labelId }),
    { sql: 'UPDATE labels SET threadCount = MAX(0, threadCount - 1) WHERE id = ?', bindValues: [labelId] },
  ],
})

const state = State.SQLite.makeState({ tables: mailboxTables, materializers })

export const schema = makeSchema({ events: mailboxEvents, state, devtools: { alias: 'mailbox' } })
