import type * as otel from '@opentelemetry/api'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { provideOtel } from '@livestore/common'
import { createStore, defineCommand, Events, makeSchema, State } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import { Effect, Schema } from '@livestore/utils/effect'

export type Todo = {
  id: string
  text: string
  completed: boolean
}

export type Filter = 'all' | 'active' | 'completed'

export type AppState = {
  newTodoText: string
  filter: Filter
}

export const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
    completed: State.SQLite.boolean({ default: false, nullable: false }),
  },
})

export const app = State.SQLite.clientDocument({
  name: 'app',
  schema: Schema.Struct({
    newTodoText: Schema.String,
    filter: Schema.String,
  }),
  default: { value: { newTodoText: '', filter: 'all' } },
})

export const tables = { todos, app }

export const events = {
  todoCreated: Events.synced({
    name: 'todo.created',
    schema: Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }),
  }),
  todoCompleted: Events.synced({
    name: 'todo.completed',
    schema: Schema.Struct({
      id: Schema.String,
    }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  'todo.created': ({ id, text, completed }) => tables.todos.insert({ id, text, completed }),
  'todo.completed': ({ id }) => tables.todos.update({ completed: true }).where({ id }),
})

export const state = State.SQLite.makeState({ tables, materializers })

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
      const todo = ctx.query(tables.todos.where({ id }).first())
      if (todo === null) throw new Error('Todo not found')
      return events.todoCompleted({ id })
    },
  }),
  createTodoUnique: defineCommand({
    name: 'CreateTodoUnique',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    handler: ({ id, text }, ctx) => {
      const existing = ctx.query(tables.todos.where({ id }).first())
      if (existing !== null) return new TodoAlreadyExists()
      return events.todoCreated({ id, text, completed: false })
    },
  }),
  emptyCommand: defineCommand({
    name: 'EmptyCommand',
    schema: Schema.Struct({}),
    handler: () => [] as const,
  }),
  multiEventCommand: defineCommand({
    name: 'MultiEvent',
    schema: Schema.Struct({
      todos: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
    }),
    handler: ({ todos }) =>
      todos.map(({ id, text }) => events.todoCreated({ id, text, completed: false })),
  }),
  /** Embeds `ctx.phase._tag` into the todo text so tests can verify the execution phase. */
  capturePhase: defineCommand({
    name: 'CapturePhase',
    schema: Schema.Struct({ id: Schema.String }),
    handler: ({ id }, ctx) => events.todoCreated({ id, text: ctx.phase._tag, completed: false }),
  }),
  /** Uses raw SQL via `ctx.query` to count existing todos and embeds the count in the todo text. */
  countTodosRawSql: defineCommand({
    name: 'CountTodosRawSql',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    handler: ({ id, text }, ctx) => {
      const rows = ctx.query({ query: 'SELECT COUNT(*) as cnt FROM todos', bindValues: {} }) as Array<{ cnt: number }>
      const count = rows[0]?.cnt ?? 0
      return events.todoCreated({ id, text: `${text} (count: ${count})`, completed: false })
    },
  }),
  /** Handler that throws a string value instead of an Error instance. */
  throwsString: defineCommand({
    name: 'ThrowsString',
    schema: Schema.Struct({}),
    handler: () => {
      throw 'something went wrong'
    },
  }),
  /** Handler that throws a plain object instead of an Error instance. */
  throwsPlainObject: defineCommand({
    name: 'ThrowsPlainObject',
    schema: Schema.Struct({}),
    handler: () => {
      throw { code: 42, detail: 'unexpected' }
    },
  }),
}

export const schema = makeSchema({ state, events, commands })

export const makeTodoMvc = ({
  otelTracer,
  otelContext,
}: {
  otelTracer?: otel.Tracer
  otelContext?: otel.Context
} = {}) =>
  Effect.gen(function* () {
    const store = yield* createStore({
      schema,
      storeId: 'default',
      adapter: makeInMemoryAdapter(),
      debug: { instanceId: 'test' },
    })

    return store
  }).pipe(provideOtel(omitUndefineds({ parentSpanContext: otelContext, otelTracer: otelTracer })))
