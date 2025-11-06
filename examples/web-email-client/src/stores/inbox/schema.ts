import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

/**
 * Inbox Aggregate (Singleton)
 *
 * Purpose: Manage system labels (INBOX, SENT, ARCHIVE, TRASH), thread collection, and UI state
 *
 * This aggregate handles:
 * - System label definitions and metadata
 * - Label thread counts (updated by cross-aggregate events)
 * - Label organization and display properties
 * - Thread index (projection from Thread aggregates for efficient querying)
 * - Thread-label associations (projection from Thread aggregates)
 * - Global UI state (selected thread, label, compose state)
 */

export const inboxTables = {
  labels: State.SQLite.table({
    name: 'labels',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      type: State.SQLite.text(), // 'system' | 'user' (user labels out of scope for prototype)
      color: State.SQLite.text(),
      threadCount: State.SQLite.integer({ default: 0 }),
      displayOrder: State.SQLite.integer({ default: 0 }), // Display order in UI
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),

  // Thread index - projection of thread metadata from Thread aggregates
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

  // Thread-label associations - projection from Thread aggregates
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
      selectedLabelId: Schema.String.pipe(Schema.NullOr), // 'inbox', 'sent', etc.
      composeDraft: Schema.String,
      isComposing: Schema.Boolean,
    }),
    default: {
      id: SessionIdSymbol,
      value: {
        selectedThreadId: null,
        selectedLabelId: null,
        composeDraft: '',
        isComposing: false,
      },
    },
  }),
}

export const inboxEvents = {
  // System label creation (happens during seed/initialization)
  labelCreated: Events.synced({
    name: 'v1.LabelCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      type: Schema.Literal('system', 'user'),
      color: Schema.String,
      displayOrder: Schema.Number,
      createdAt: Schema.Date,
    }),
  }),

  // Cross-aggregate event: triggered when thread labels are applied/removed
  labelThreadCountUpdated: Events.synced({
    name: 'v1.LabelThreadCountUpdated',
    schema: Schema.Struct({
      labelId: Schema.String,
      newCount: Schema.Number,
      updatedAt: Schema.Date,
    }),
  }),

  threadAdded: Events.synced({
    name: 'v1.ThreadAdded',
    schema: Schema.Struct({
      id: Schema.String,
      subject: Schema.String,
      participants: Schema.Array(Schema.String), // Array of email addresses
      createdAt: Schema.Date,
    }),
  }),

  // UI state events (client-only)
  uiStateSet: inboxTables.uiState.set,
}

const materializers = State.SQLite.materializers(inboxEvents, {
  'v1.LabelCreated': ({ id, name, type, color, displayOrder, createdAt }) =>
    inboxTables.labels.insert({ id, name, type, color, displayOrder, threadCount: 0, createdAt }),

  'v1.LabelThreadCountUpdated': ({ labelId, newCount }) => {
    return inboxTables.labels.update({ threadCount: newCount }).where({ id: labelId })
  },
  'v1.ThreadAdded': ({ id, subject, participants, createdAt }) =>
    inboxTables.threadIndex.insert({
      id,
      subject,
      participants: JSON.stringify(participants),
      lastActivity: createdAt,
      createdAt,
    }),
})

const state = State.SQLite.makeState({ tables: inboxTables, materializers })

export const schema = makeSchema({ events: inboxEvents, state, devtools: { alias: 'inbox' } })
