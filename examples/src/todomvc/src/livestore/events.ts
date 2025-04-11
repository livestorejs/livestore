import { Events, Schema } from '@livestore/livestore'

/**
 * LiveStore embraces event sourcing, so data changes are defined as events
 * (sometimes referred to as "write model"). Those events are then synced across clients
 * and materialize to state (i.e. SQLite tables).
 *
 * Once your app is in production, please make sure your event definitions evolve in a backwards compatible way.
 * See docs to learn more: https://next.livestore.dev/docs/reference/events
 */

export const todoCreated = Events.synced({
  name: 'v1.TodoCreated',
  schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
})

export const todoCompleted = Events.synced({
  name: 'v1.TodoCompleted',
  schema: Schema.Struct({ id: Schema.String }),
})

export const todoUncompleted = Events.synced({
  name: 'v1.TodoUncompleted',
  schema: Schema.Struct({ id: Schema.String }),
})

export const todoDeleted = Events.synced({
  name: 'v1.TodoDeleted',
  schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
})

export const todoClearedCompleted = Events.synced({
  name: 'v1.TodoClearedCompleted',
  schema: Schema.Struct({ deletedAt: Schema.Date }),
})
