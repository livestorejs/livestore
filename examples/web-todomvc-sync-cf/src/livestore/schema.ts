import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

// You can model your state as SQLite tables (https://docs.livestore.dev/reference/state/sqlite-schema)
export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text({ default: '' }),
      completed: State.SQLite.boolean({ default: false }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  // Client documents can be used for local-only state (e.g. form inputs)
  uiState: State.SQLite.clientDocument({
    name: 'uiState',
    schema: Schema.Struct({ newTodoText: Schema.String, filter: Schema.Literal('all', 'active', 'completed') }),
    default: { id: SessionIdSymbol, value: { newTodoText: '', filter: 'all' } },
  }),
}

// Events describe data changes (https://docs.livestore.dev/reference/events)
export const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
  todoCompleted: Events.synced({
    name: 'v1.TodoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoUncompleted: Events.synced({
    name: 'v1.TodoUncompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeleted: Events.synced({
    name: 'v1.TodoDeleted',
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
  }),
  todoClearedCompleted: Events.synced({
    name: 'v1.TodoClearedCompleted',
    schema: Schema.Struct({ deletedAt: Schema.Date }),
  }),
  uiStateSet: tables.uiState.set,
}

// Materializers are used to map events to state (https://docs.livestore.dev/reference/state/materializers)
const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text }) => tables.todos.insert({ id, text, completed: false }),
  'v1.TodoCompleted': ({ id }) => tables.todos.update({ completed: true }).where({ id }),
  'v1.TodoUncompleted': ({ id }) => tables.todos.update({ completed: false }).where({ id }),
  'v1.TodoDeleted': ({ id, deletedAt }) => tables.todos.update({ deletedAt }).where({ id }),
  'v1.TodoClearedCompleted': ({ deletedAt }) => tables.todos.update({ deletedAt }).where({ completed: true }),
})

const state = State.SQLite.makeState({ tables, materializers })

// Schema 1: Default behavior (no callback provided)
// → Logs warning and continues processing
export const schema1 = makeSchema({ 
  events, 
  state
  // No onUnknownEvent callback = default warning logging
})

// Schema 2: Custom callback with environment-specific logic
export const schema2 = makeSchema({ 
  events, 
  state,
  onUnknownEvent: ({ eventName, eventData, availableEvents }) => {
    // User-provided callback disables default logging
    
    // Example: Log information about unknown events for debugging
    console.group(`🔍 Unknown Event: ${eventName}`)
    console.log('Event Data:', eventData)
    console.log('Available Events:', availableEvents)
    console.log('Schema Version: v1.x')
    console.groupEnd()
    
    // NOTE: Event migration/aliasing should be handled through schema evolution
    // and replay mechanisms rather than runtime retry actions
    
    // Handle events that might be from newer versions
    // Note: In LiveStore, events are never removed once defined (append-only evolution)
    // This is just for demonstration of unknown event handling
    
    // Development vs Production behavior
    if (import.meta.env.DEV) {
      console.warn(`⚠️ DEV: Unknown event '${eventName}' - continuing for development`)
      return { action: 'continue' }
    } else {
      console.error(`❌ PROD: Unknown event '${eventName}' not allowed`)
      return { 
        action: 'fail', 
        error: `Unknown event '${eventName}' - please update your app to the latest version` 
      }
    }
  }
})

// Schema 3: Silent handling (ignore unknown events)
export const schema3 = makeSchema({ 
  events, 
  state,
  onUnknownEvent: ({ eventName }) => {
    // Silently ignore all unknown events
    return { action: 'continue' }
  }
})

// Schema 4: Strict handling (fail on any unknown event)
export const schema4 = makeSchema({ 
  events, 
  state,
  onUnknownEvent: ({ eventName }) => {
    return { 
      action: 'fail', 
      error: `Unknown event '${eventName}' not allowed in this application version` 
    }
  }
})

// Schema 5: Custom logging with metrics
export const schema5 = makeSchema({ 
  events, 
  state,
  onUnknownEvent: ({ eventName, eventData, availableEvents }) => {
    // Custom logging format
    console.group(`🔍 Unknown Event: ${eventName}`)
    console.log('Event Data:', eventData)
    console.log('Available Events:', availableEvents)
    console.log('Timestamp:', new Date().toISOString())
    console.groupEnd()
    
    // Example: Send to analytics/metrics service
    // analytics.track('unknown_event', { eventName, timestamp: Date.now() })
    
    // Continue processing after logging
    return { action: 'continue' }
  }
})

// Default export - using the migration callback for the demo
export const schema = schema2
