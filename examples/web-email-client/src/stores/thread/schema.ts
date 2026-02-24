import { defineCommand, Events, makeSchema, Schema, State } from '@livestore/livestore'

export const threadTables = {
  thread: State.SQLite.table({
    name: 'thread',
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
  threadCreated: Events.synced({
    name: 'v1.ThreadCreated',
    schema: Schema.Struct({
      id: Schema.String,
      subject: Schema.String,
      participants: Schema.Array(Schema.String), // Array of email addresses
      createdAt: Schema.Date,
    }),
  }),

  messageAdded: Events.synced({
    name: 'v1.MessageAdded',
    schema: Schema.Struct({
      id: Schema.String,
      threadId: Schema.String,
      content: Schema.String,
      sender: Schema.String,
      senderName: Schema.String.pipe(Schema.NullOr),
      timestamp: Schema.Date,
    }),
  }),

  // Thread-label association applied (triggers cross-store update)
  threadLabelApplied: Events.synced({
    name: 'v1.ThreadLabelApplied',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      appliedAt: Schema.Date,
    }),
  }),

  // Thread-label association removed (triggers cross-store update)
  threadLabelRemoved: Events.synced({
    name: 'v1.ThreadLabelRemoved',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      removedAt: Schema.Date,
    }),
  }),
}

export const materializers = State.SQLite.materializers(threadEvents, {
  'v1.ThreadCreated': ({ id, subject, participants, createdAt }) =>
    threadTables.thread.insert({
      id,
      subject,
      participants: JSON.stringify(participants),
      lastActivity: createdAt,
      createdAt,
    }),

  'v1.MessageAdded': ({ id, threadId, content, sender, senderName, timestamp }) => [
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
    threadTables.thread
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

// Typed errors for command handlers. These serve as no-op signals — callers can ignore
// the result, but during replay the errors tell the reconciliation mechanism to roll back
// redundant events (e.g. when a remote client already applied the same label).
export class LabelAlreadyApplied extends Schema.TaggedError<LabelAlreadyApplied>()('LabelAlreadyApplied', {}) {}
export class LabelNotApplied extends Schema.TaggedError<LabelNotApplied>()('LabelNotApplied', {}) {}
export class AlreadyAtTargetLabel extends Schema.TaggedError<AlreadyAtTargetLabel>()('AlreadyAtTargetLabel', {}) {}
export class NoSystemLabelApplied extends Schema.TaggedError<NoSystemLabelApplied>()('NoSystemLabelApplied', {}) {}

export const commands = {
  /**
   * Applies a user label to a thread. Idempotent — no-ops if already applied.
   *
   * Must only be called with user label IDs, never system labels. System label changes
   * must go through `moveThreadToSystemLabel` to preserve the "exactly one system label"
   * invariant. This is enforced by the application layer (the UI only exposes user labels
   * through this command), not by the handler itself — the Thread store doesn't own
   * the concept of label types (that's a Mailbox store concern).
   */
  applyUserLabel: defineCommand({
    name: 'ApplyUserLabel',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      appliedAt: Schema.Date, // Passed in rather than generated, so replayed commands preserve the original timestamp
    }),
    handler: ({ threadId, labelId, appliedAt }, ctx) => {
      const existing = ctx.query(threadTables.threadLabels.where({ threadId, labelId }).first())
      if (existing) return new LabelAlreadyApplied()
      return threadEvents.threadLabelApplied({ threadId, labelId, appliedAt })
    },
  }),

  /**
   * Removes a user label from a thread. Idempotent — no-ops if not applied.
   *
   * Same constraint as `applyUserLabel`: must only be called with user label IDs.
   * System label removal is handled exclusively by `moveThreadToSystemLabel`.
   */
  removeUserLabel: defineCommand({
    name: 'RemoveUserLabel',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      removedAt: Schema.Date, // Passed in rather than generated, so replayed commands preserve the original timestamp
    }),
    handler: ({ threadId, labelId, removedAt }, ctx) => {
      const existing = ctx.query(threadTables.threadLabels.where({ threadId, labelId }).first())
      if (!existing) return new LabelNotApplied()
      return threadEvents.threadLabelRemoved({ threadId, labelId, removedAt })
    },
  }),

  /**
   * Atomically swaps a thread's current system label for a target (e.g. archive, trash).
   *
   * Enforces the invariant: a thread must have exactly one system label at all times.
   *
   * `systemLabelIds` is reference data from the Mailbox store (which owns label definitions).
   * The handler needs it to identify which of the thread's labels is the current system label.
   * During replay, it re-queries the thread's labels so it correctly finds the current system
   * label even if a remote client moved the thread to a different one in the meantime.
   */
  moveThreadToSystemLabel: defineCommand({
    name: 'MoveThreadToSystemLabel',
    schema: Schema.Struct({
      threadId: Schema.String,
      targetLabelId: Schema.String,
      systemLabelIds: Schema.Array(Schema.String),
      movedAt: Schema.Date, // Passed in rather than generated, so replayed commands preserve the original timestamp
    }),
    handler: ({ threadId, targetLabelId, systemLabelIds, movedAt }, ctx) => {
      const threadLabels = ctx.query(threadTables.threadLabels.where({ threadId }))
      const currentSystemLabel = threadLabels.find((tl) => systemLabelIds.includes(tl.labelId))
      if (!currentSystemLabel) return new NoSystemLabelApplied()
      if (currentSystemLabel.labelId === targetLabelId) return new AlreadyAtTargetLabel()

      return [
        threadEvents.threadLabelRemoved({ threadId, labelId: currentSystemLabel.labelId, removedAt: movedAt }),
        threadEvents.threadLabelApplied({ threadId, labelId: targetLabelId, appliedAt: movedAt }),
      ]
    },
  }),
}

export const schema = makeSchema({ events: threadEvents, state, commands, devtools: { alias: 'thread' } })
