export const todoSchemaContent = `import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

// State tables - Define your application state as SQLite tables
export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text({ default: '' }),
      completed: State.SQLite.boolean({ default: false }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      position: State.SQLite.real(), // For ordering - enables conflict-free reordering
    },
  }),
  tags: State.SQLite.table({
    name: 'tags',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      color: State.SQLite.text({ nullable: true }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
    },
  }),
  todoTags: State.SQLite.table({
    name: 'todo_tags',
    columns: {
      todoId: State.SQLite.text(),
      tagId: State.SQLite.text(),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  // Client-only state for UI (not synced)
  uiState: State.SQLite.clientDocument({
    name: 'uiState',
    schema: Schema.Struct({ 
      newTodoText: Schema.String, 
      filter: Schema.Literal('all', 'active', 'completed'),
      selectedTags: Schema.Array(Schema.String)
    }),
    default: { id: SessionIdSymbol, value: { newTodoText: '', filter: 'all', selectedTags: [] } },
  }),
}

// Events - Define state changes as events for reliable sync and replay
export const events = {
  // Todo events
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ 
      id: Schema.String, 
      title: Schema.String,
      createdAt: Schema.Date,
      position: Schema.Number
    }),
  }),
  todoCompleted: Events.synced({
    name: 'v1.TodoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoUncompleted: Events.synced({
    name: 'v1.TodoUncompleted', 
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoTitleChanged: Events.synced({
    name: 'v1.TodoTitleChanged',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
  todoReordered: Events.synced({
    name: 'v1.TodoReordered',
    schema: Schema.Struct({ id: Schema.String, position: Schema.Number }),
  }),
  todoDeleted: Events.synced({
    name: 'v1.TodoDeleted',
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
  }),
  todosCleared: Events.synced({
    name: 'v1.TodosCleared', 
    schema: Schema.Struct({ deletedAt: Schema.Date }),
  }),
  
  // Tag events
  tagCreated: Events.synced({
    name: 'v1.TagCreated',
    schema: Schema.Struct({ 
      id: Schema.String, 
      name: Schema.String, 
      color: Schema.NullOr(Schema.String),
      createdAt: Schema.Date
    }),
  }),
  tagDeleted: Events.synced({
    name: 'v1.TagDeleted',
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
  }),
  
  // Todo-Tag relationship events
  todoTagged: Events.synced({
    name: 'v1.TodoTagged',
    schema: Schema.Struct({ todoId: Schema.String, tagId: Schema.String, createdAt: Schema.Date }),
  }),
  todoUntagged: Events.synced({
    name: 'v1.TodoUntagged',
    schema: Schema.Struct({ todoId: Schema.String, tagId: Schema.String }),
  }),
  
  // UI state events (local only)
  uiStateSet: tables.uiState.set,
}

// Materializers - Map events to state changes with conflict-free semantics
const materializers = State.SQLite.materializers(events, {
  // Todo materializers
  'v1.TodoCreated': ({ id, title, createdAt, position }) => 
    tables.todos.insert({ id, title, completed: false, createdAt, position }),
    
  'v1.TodoCompleted': ({ id }) => 
    tables.todos.update({ completed: true }).where({ id }),
    
  'v1.TodoUncompleted': ({ id }) => 
    tables.todos.update({ completed: false }).where({ id }),
    
  'v1.TodoTitleChanged': ({ id, title }) => 
    tables.todos.update({ title }).where({ id }),
    
  'v1.TodoReordered': ({ id, position }) => 
    tables.todos.update({ position }).where({ id }),
    
  'v1.TodoDeleted': ({ id, deletedAt }) => 
    tables.todos.update({ deletedAt }).where({ id }),
    
  'v1.TodosCleared': ({ deletedAt }) => 
    tables.todos.update({ deletedAt }).where({ completed: true, deletedAt: null }),
    
  // Tag materializers  
  'v1.TagCreated': ({ id, name, color, createdAt }) => 
    tables.tags.insert({ id, name, color, createdAt }),
    
  'v1.TagDeleted': ({ id, deletedAt }) => 
    tables.tags.update({ deletedAt }).where({ id }),
    
  // Todo-Tag relationship materializers
  'v1.TodoTagged': ({ todoId, tagId, createdAt }) => 
    tables.todoTags.insert({ todoId, tagId, createdAt }),
    
  'v1.TodoUntagged': ({ todoId, tagId }) => 
    tables.todoTags.delete().where({ todoId, tagId }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })

// Example usage:
// 
// import { queryDb, dispatchEvent } from '@livestore/livestore'
// import { schema, events, tables } from './schema.js'
//
// // Query active todos
// const activeTodos$ = queryDb(
//   tables.todos.select().where({ deletedAt: null, completed: false }).orderBy('position'),
//   { label: 'activeTodos' }
// )
//
// // Create a new todo
// const createTodo = (title: string) => {
//   const id = crypto.randomUUID()
//   const position = Date.now() // Simple position strategy
//   dispatchEvent(events.todoCreated({ id, title, createdAt: new Date(), position }))
// }`
