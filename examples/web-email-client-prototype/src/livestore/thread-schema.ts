import { Events, Schema, SessionIdSymbol, State } from '@livestore/livestore'

/**
 * Thread Aggregate
 *
 * Purpose: Core unit for email threads (collections of related messages)
 * Event Log: Variable size (10-100KB per thread)
 *
 * This aggregate handles:
 * - Email threads and their metadata
 * - Individual messages within threads
 * - Thread-label associations (many-to-many relationship)
 * - Message read/unread status
 * - Cross-aggregate event emission for label count updates
 */

// Tables for Thread Aggregate
export const threadTables = {
  threads: State.SQLite.table({
    name: 'threads',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      subject: State.SQLite.text(),
      participants: State.SQLite.text(), // JSON array of email addresses
      lastActivity: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      messageCount: State.SQLite.integer({ default: 0 }),
      unreadCount: State.SQLite.integer({ default: 0 }),
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
      isRead: State.SQLite.boolean({ default: false }),
      isDraft: State.SQLite.boolean({ default: false }),
      messageType: State.SQLite.text(), // 'received' | 'sent' | 'draft'
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

// Events for Thread Aggregate
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

  // Message status events
  messageRead: Events.synced({
    name: 'v1.MessageRead',
    schema: Schema.Struct({
      messageId: Schema.String,
      isRead: Schema.Boolean,
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

  // UI state events (client-only)
  uiStateSet: threadTables.uiState.set,
}

// Materializers for Thread Aggregate
export const threadMaterializers = State.SQLite.materializers(threadEvents, {
  'v1.ThreadCreated': ({ id, subject, participants, createdAt }) =>
    threadTables.threads.insert({
      id,
      subject,
      participants: JSON.stringify(participants),
      lastActivity: createdAt,
      messageCount: 0,
      unreadCount: 0,
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
      isRead: false,
      isDraft: false,
      messageType: 'received',
    }),
    // Note: For prototype, we'll handle counting in application logic
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
      isRead: true, // Sent messages are always "read"
      isDraft: false,
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
      isRead: false,
      isDraft: true,
      messageType: 'draft',
    }),
    threadTables.threads
      .update({
        lastActivity: timestamp,
      })
      .where({ id: threadId }),
  ],

  'v1.MessageRead': ({ messageId, isRead }) => [
    threadTables.messages
      .update({ isRead })
      .where({ id: messageId }),
    // Note: For prototype, we'll handle unread counting in application logic
  ],

  'v1.ThreadLabelApplied': ({ threadId, labelId, appliedAt }) =>
    threadTables.threadLabels.insert({ threadId, labelId, appliedAt }),

  'v1.ThreadLabelRemoved': ({ threadId, labelId }) => threadTables.threadLabels.delete().where({ threadId, labelId }),
})
