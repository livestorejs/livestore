import { defineCommand, Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

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

export const commands = {
  createTodo: defineCommand({
    name: 'CreateTodo',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    handler: ({ id, text }) => {
      const trimmedText = text.trim()
      if (trimmedText.length === 0) {
        throw new Error('Todo text cannot be empty')
      }
      return [events.todoCreated({ id, text: trimmedText }), events.uiStateSet({ newTodoText: '' })]
    },
  }),

  toggleTodo: defineCommand({
    name: 'ToggleTodo',
    schema: Schema.Struct({ id: Schema.String }),
    handler: ({ id }, { state }) => {
      const todo = state.query<typeof tables.todos.Type | undefined>(tables.todos.where({ id }).first())
      if (!todo) throw new Error('Todo not found')
      if (todo.deletedAt) throw new Error('Cannot toggle deleted todo')

      return [todo.completed ? events.todoUncompleted({ id }) : events.todoCompleted({ id })]
    },
  }),

  deleteTodo: defineCommand({
    name: 'DeleteTodo',
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
    handler: ({ id, deletedAt }, { state }) => {
      const todo = state.query<typeof tables.todos.Type | undefined>(tables.todos.where({ id }).first())
      if (!todo) throw new Error('Todo not found')
      if (todo.deletedAt) throw new Error('Todo already deleted')

      return [events.todoDeleted({ id, deletedAt })]
    },
  }),

  clearCompleted: defineCommand({
    name: 'ClearCompleted',
    schema: Schema.Struct({ deletedAt: Schema.Date }),
    handler: ({ deletedAt }, { state }) => {
      const completedCount = state.query<number>(tables.todos.count().where({ completed: true, deletedAt: null }))
      if (completedCount === 0) {
        throw new Error('No completed todos to clear')
      }
      return [events.todoClearedCompleted({ deletedAt })]
    },
  }),
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

export const schema = makeSchema({ events, state, commands })

// Shared sync payload schema for this example
export const SyncPayload = Schema.Struct({ authToken: Schema.String })
