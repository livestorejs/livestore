import { Events, Schema } from '@livestore/livestore'

/**
 * LiveStore embraces event sourcing, so data changes are defined as events
 * (sometimes referred to as "write model"). Those events are then synced across clients
 * and reduced to state (i.e. your app state as SQLite tables).
 *
 * Global events are synced across all clients, client events are local only.
 *
 * Once your app is in production, please make sure your event definitions evolve in a backwards compatible way.
 * See docs to learn more: https://next.livestore.dev/docs/reference/events
 */

export const todoCreated = Events.global({
  name: 'v1.TodoCreated',
  schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
})

export const todoCompleted = Events.global({
  name: 'v1.TodoCompleted',
  schema: Schema.Struct({ id: Schema.String }),
})

export const todoUncompleted = Events.global({
  name: 'v1.TodoUncompleted',
  schema: Schema.Struct({ id: Schema.String }),
})

export const todoDeleted = Events.global({
  name: 'v1.TodoDeleted',
  schema: Schema.Struct({ id: Schema.String, deleted: Schema.Date }),
})

export const todoClearedCompleted = Events.global({
  name: 'v1.TodoClearedCompleted',
  schema: Schema.Struct({ deleted: Schema.DateFromNumber }),
})
