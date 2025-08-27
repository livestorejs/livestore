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
  uiState: State.SQLite.clientDocument({
    name: 'uiState',
    schema: Schema.Struct({
      userContext: Schema.Struct({
        username: Schema.String,
        userId: Schema.String,
        hasJoined: Schema.Boolean,
      }).pipe(Schema.UndefinedOr),
    }),
    default: {
      id: 'singleton',
      value: { userContext: undefined },
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
}

// Materializers map events to state changes
const materializers = State.SQLite.materializers(events, {
  'v1.MessageCreated': ({ id, text, userId, username, timestamp, isBot }) =>
    tables.messages.insert({ id, text, userId, username, timestamp, isBot }),
  'v1.UserJoined': ({ userId, username, timestamp }) => tables.users.insert({ userId, username, timestamp }),
  'v1.ReactionAdded': ({ id, messageId, emoji, userId, username }) =>
    tables.reactions.insert({ id, messageId, emoji, userId, username }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
