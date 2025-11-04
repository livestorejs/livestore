import { Events, makeSchema, Schema, State } from '@livestore/livestore'

/**
 * Thread Aggregate
 *
 * Purpose: Core unit for email threads (collections of related messages)
 * Event Log: Variable size (10-100KB per thread)
 *
 * This aggregate is the SOURCE OF TRUTH for:
 * - Email threads and their metadata
 * - Individual messages within threads
 * - Thread-label associations (enforces business rules)
 *
 * Cross-aggregate synchronization:
 * - Thread events are consumed by Labels aggregate to maintain queryable projections
 * - Labels aggregate maintains threadIndex and threadLabels for efficient filtering
 * - All label operations must go through this aggregate to enforce consistency
 */

export const threadTables = {
  threads: State.SQLite.table({
    name: 'threads',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      subject: State.SQLite.text(),
      participants: State.SQLite.text(), // JSON array of email addresses
      lastActivity: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),

  messages: State.SQLite.table({
    name: 'messages',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      threadId: State.SQLite.text(),
      content: State.SQLite.text(),
      sender: State.SQLite.text(), // Email address
      senderName: State.SQLite.text({ nullable: true }), // Display name
      timestamp: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      messageType: State.SQLite.text({
        schema: Schema.Literal('received', 'sent', 'draft'),
      }),
    },
  }),

  threadLabels: State.SQLite.table({
    name: 'threadLabels',
    columns: {
      threadId: State.SQLite.text(),
      labelId: State.SQLite.text(),
      appliedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
}

export const threadEvents = {
  // Thread lifecycle events
  threadCreated: Events.synced({
    name: 'v1.ThreadCreated',
    schema: Schema.Struct({
      id: Schema.String,
      subject: Schema.String,
      participants: Schema.Array(Schema.String), // Array of email addresses
      createdAt: Schema.Date,
    }),
  }),

  // Message lifecycle events
  messageReceived: Events.synced({
    name: 'v1.MessageReceived',
    schema: Schema.Struct({
      id: Schema.String,
      threadId: Schema.String,
      content: Schema.String,
      sender: Schema.String,
      senderName: Schema.String.pipe(Schema.NullOr),
      timestamp: Schema.Date,
    }),
  }),

  messageSent: Events.synced({
    name: 'v1.MessageSent',
    schema: Schema.Struct({
      id: Schema.String,
      threadId: Schema.String,
      content: Schema.String,
      sender: Schema.String,
      senderName: Schema.String.pipe(Schema.NullOr),
      timestamp: Schema.Date,
    }),
  }),

  draftCreated: Events.synced({
    name: 'v1.DraftCreated',
    schema: Schema.Struct({
      id: Schema.String,
      threadId: Schema.String,
      content: Schema.String,
      sender: Schema.String,
      timestamp: Schema.Date,
    }),
  }),

  // Label association events (these trigger cross-aggregate updates)
  threadLabelApplied: Events.synced({
    name: 'v1.ThreadLabelApplied',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      appliedAt: Schema.Date,
    }),
  }),

  threadLabelRemoved: Events.synced({
    name: 'v1.ThreadLabelRemoved',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      removedAt: Schema.Date,
    }),
  }),
}

// Materializers for Thread Aggregate
export const materializers = State.SQLite.materializers(threadEvents, {
  'v1.ThreadCreated': ({ id, subject, participants, createdAt }) =>
    threadTables.threads.insert({
      id,
      subject,
      participants: JSON.stringify(participants),
      lastActivity: createdAt,
      createdAt,
    }),

  'v1.MessageReceived': ({ id, threadId, content, sender, senderName, timestamp }) => [
    threadTables.messages.insert({
      id,
      threadId,
      content,
      sender,
      senderName,
      timestamp,
      messageType: 'received',
    }),
    // Update thread activity timestamp
    threadTables.threads
      .update({
        lastActivity: timestamp,
      })
      .where({ id: threadId }),
  ],

  'v1.MessageSent': ({ id, threadId, content, sender, senderName, timestamp }) => [
    threadTables.messages.insert({
      id,
      threadId,
      content,
      sender,
      senderName,
      timestamp,
      messageType: 'sent',
    }),
    threadTables.threads
      .update({
        lastActivity: timestamp,
      })
      .where({ id: threadId }),
  ],

  'v1.DraftCreated': ({ id, threadId, content, sender, timestamp }) => [
    threadTables.messages.insert({
      id,
      threadId,
      content,
      sender,
      senderName: null,
      timestamp,
      messageType: 'draft',
    }),
    threadTables.threads
      .update({
        lastActivity: timestamp,
      })
      .where({ id: threadId }),
  ],

  'v1.ThreadLabelApplied': ({ threadId, labelId, appliedAt }) =>
    threadTables.threadLabels.insert({ threadId, labelId, appliedAt }),

  'v1.ThreadLabelRemoved': ({ threadId, labelId }) => threadTables.threadLabels.delete().where({ threadId, labelId }),
})

const state = State.SQLite.makeState({ tables: threadTables, materializers })

export const schema = makeSchema({ events: threadEvents, state, devtools: { alias: 'thread' } })
