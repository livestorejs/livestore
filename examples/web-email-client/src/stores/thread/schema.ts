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

export class LabelAlreadyApplied extends Schema.TaggedError<LabelAlreadyApplied>()('LabelAlreadyApplied', {}) {}
export class LabelNotOnThread extends Schema.TaggedError<LabelNotOnThread>()('LabelNotOnThread', {}) {}

export const threadCommands = {
  applyLabel: defineCommand({
    name: 'ApplyLabel',
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

  removeLabel: defineCommand({
    name: 'RemoveLabel',
    schema: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      removedAt: Schema.Date, // Passed in rather than generated, so replayed commands preserve the original timestamp
    }),
    handler: ({ threadId, labelId, removedAt }, ctx) => {
      const existing = ctx.query(threadTables.threadLabels.where({ threadId, labelId }).first())
      if (!existing) return new LabelNotOnThread()
      return threadEvents.threadLabelRemoved({ threadId, labelId, removedAt })
    },
  }),

  replaceLabel: defineCommand({
    name: 'ReplaceLabel',
    schema: Schema.Struct({
      threadId: Schema.String,
      currentLabelId: Schema.String,
      targetLabelId: Schema.String,
      replacedAt: Schema.Date, // Passed in rather than generated, so replayed commands preserve the original timestamp
    }),
    handler: ({ threadId, currentLabelId, targetLabelId, replacedAt }, ctx) => {
      const threadLabels = ctx.query(threadTables.threadLabels.where({ threadId }))

      const currentLabel = threadLabels.find((tl) => tl.labelId === currentLabelId)
      if (!currentLabel) return new LabelNotOnThread()

      if (currentLabel.labelId === targetLabelId) return new LabelAlreadyApplied()

      return [
        threadEvents.threadLabelRemoved({ threadId, labelId: currentLabel.labelId, removedAt: replacedAt }),
        threadEvents.threadLabelApplied({ threadId, labelId: targetLabelId, appliedAt: replacedAt }),
      ]
    },
  }),
}

export const schema = makeSchema({ events: threadEvents, state, commands: threadCommands, devtools: { alias: 'thread' } })
