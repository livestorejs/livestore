import { defineCommand, Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
    deletedAt: State.SQLite.datetime({ default: null, nullable: true }),
  },
})

const Config = Schema.Struct({
  fontSize: Schema.Number,
  theme: Schema.Literal('light', 'dark'),
})

const appConfig = State.SQLite.clientDocument({
  name: 'app_config',
  schema: Config,
  default: { value: { fontSize: 16, theme: 'light' } },
})

const appConfigTable = appConfig as typeof appConfig & State.SQLite.ClientDocumentTableDef<any, any, any, any>

export const appConfigSetEvent = appConfigTable[State.SQLite.ClientDocumentTableDefSymbol].derived.setEventDef

export const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean.pipe(Schema.optional) }),
  }),
  todoCompleted: Events.synced({
    name: 'todoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeleted: Events.synced({
    name: 'todoDeleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeletedNonPure: Events.synced({
    name: 'todoDeletedNonPure',
    schema: Schema.Struct({ id: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }) => todos.insert({ id, text, completed: completed ?? false }),
  todoCompleted: ({ id }) => todos.update({ completed: true }).where({ id }),
  todoDeleted: ({ id }) => todos.delete().where({ id }),
  // This materialize is non-pure as `new Date()` is side effecting
  todoDeletedNonPure: ({ id }) => todos.update({ deletedAt: new Date() }).where({ id }),
})

export const tables = { todos, appConfig }

const state = State.SQLite.makeState({ tables, materializers })

export class TodoTextEmpty extends Schema.TaggedError<TodoTextEmpty>()('TodoTextEmpty', {}) {}
export class TodoAlreadyExists extends Schema.TaggedError<TodoAlreadyExists>()('TodoAlreadyExists', {}) {}

export const commands = {
  createTodo: defineCommand({
    name: 'CreateTodo',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    handler: ({ id, text }) => {
      const trimmedText = text.trim()
      if (trimmedText.length === 0) return new TodoTextEmpty()
      return events.todoCreated({ id, text: trimmedText, completed: false })
    },
  }),
  completeTodo: defineCommand({
    name: 'CompleteTodo',
    schema: Schema.Struct({ id: Schema.String }),
    handler: ({ id }, ctx) => {
      ctx.query(tables.todos.where({ id }).first({ behaviour: 'error' }))
      return events.todoCompleted({ id })
    },
  }),
  createTodoUnique: defineCommand({
    name: 'CreateTodoUnique',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    handler: ({ id, text }, ctx) => {
      const existing = ctx.query(tables.todos.where({ id }).first())
      if (existing !== undefined) return new TodoAlreadyExists()
      return events.todoCreated({ id, text, completed: false })
    },
  }),
  emptyCommand: defineCommand({
    name: 'EmptyCommand',
    schema: Schema.Struct({}),
    handler: () => [] as const,
  }),
}

export const schema = makeSchema({ state, events, commands })
