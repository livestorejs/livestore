import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Tables define the SQLite schema
export const tables = {
  messages: State.SQLite.table({
    name: 'messages',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
      userId: State.SQLite.text(),
      username: State.SQLite.text(),
      timestamp: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      isBot: State.SQLite.boolean({ default: false }),
    },
  }),
  users: State.SQLite.table({
    name: 'users',
    columns: {
      userId: State.SQLite.text({ primaryKey: true }),
      username: State.SQLite.text(),
      avatarEmoji: State.SQLite.text({ default: '🙂' }),
      avatarColor: State.SQLite.text({ default: '#60a5fa' }),
      timestamp: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  reactions: State.SQLite.table({
    name: 'reactions',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      messageId: State.SQLite.text(),
      emoji: State.SQLite.text(),
      userId: State.SQLite.text(),
      username: State.SQLite.text(),
    },
  }),
  readReceipts: State.SQLite.table({
    name: 'readReceipts',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      messageId: State.SQLite.text(),
      userId: State.SQLite.text(),
      username: State.SQLite.text(),
      timestamp: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  botProcessedMessages: State.SQLite.table({
    name: 'botProcessedMessages',
    columns: {
      messageId: State.SQLite.text({ primaryKey: true }),
      processedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  uiState: State.SQLite.clientDocument({
    name: 'uiState',
    schema: Schema.Struct({
      userContext: Schema.Struct({
        username: Schema.String,
        userId: Schema.String,
        hasJoined: Schema.Boolean,
        avatarEmoji: Schema.String.pipe(Schema.UndefinedOr),
        avatarColor: Schema.String.pipe(Schema.UndefinedOr),
      }).pipe(Schema.UndefinedOr),
      lastSeenMessageId: Schema.String.pipe(Schema.NullOr),
    }),
    default: {
      id: 'singleton',
      value: { userContext: undefined, lastSeenMessageId: null },
    },
  }),
}

// Events describe data changes
export const events = {
  messageCreated: Events.synced({
    name: 'v1.MessageCreated',
    schema: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      userId: Schema.String,
      username: Schema.String,
      timestamp: Schema.Date,
      isBot: Schema.Boolean,
    }),
  }),
  userJoined: Events.synced({
    name: 'v1.UserJoined',
    schema: Schema.Struct({
      userId: Schema.String,
      username: Schema.String,
      avatarEmoji: Schema.String,
      avatarColor: Schema.String,
      timestamp: Schema.Date,
    }),
  }),
  reactionAdded: Events.synced({
    name: 'v1.ReactionAdded',
    schema: Schema.Struct({
      id: Schema.String,
      messageId: Schema.String,
      emoji: Schema.String,
      userId: Schema.String,
      username: Schema.String,
    }),
  }),
  reactionRemoved: Events.synced({
    name: 'v1.ReactionRemoved',
    schema: Schema.Struct({
      id: Schema.String,
    }),
  }),
  messageRead: Events.synced({
    name: 'v1.MessageRead',
    schema: Schema.Struct({
      id: Schema.String,
      messageId: Schema.String,
      userId: Schema.String,
      username: Schema.String,
      timestamp: Schema.Date,
    }),
  }),
  botProcessedMessage: Events.synced({
    name: 'v1.BotProcessedMessage',
    schema: Schema.Struct({
      messageId: Schema.String,
      processedAt: Schema.Date,
    }),
  }),
}

// Materializers map events to state changes
const materializers = State.SQLite.materializers(events, {
  'v1.MessageCreated': ({ id, text, userId, username, timestamp, isBot }) =>
    tables.messages.insert({ id, text, userId, username, timestamp, isBot }),
  'v1.UserJoined': ({ userId, username, avatarEmoji, avatarColor, timestamp }) =>
    tables.users.insert({ userId, username, avatarEmoji, avatarColor, timestamp }),
  'v1.ReactionAdded': ({ id, messageId, emoji, userId, username }) =>
    tables.reactions.insert({ id, messageId, emoji, userId, username }),
  'v1.ReactionRemoved': ({ id }) => tables.reactions.delete().where({ id }),
  'v1.MessageRead': ({ id, messageId, userId, username, timestamp }) =>
    // Read receipts can be emitted multiple times from different clients for the
    // same (messageId, userId). Use ON CONFLICT DO NOTHING for idempotency.
    tables.readReceipts
      .insert({ id, messageId, userId, username, timestamp })
      .onConflict('id', 'ignore'),
  'v1.BotProcessedMessage': ({ messageId, processedAt }) =>
    tables.botProcessedMessages.insert({ messageId, processedAt }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

// Shared sync payload schema for this example
export const SyncPayload = Schema.Struct({ authToken: Schema.String })
