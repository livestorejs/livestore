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

export const highlights = State.SQLite.table({
  name: 'highlights',
  columns: {
    todoId: State.SQLite.text({ primaryKey: true }),
  },
})

export const tables = { todos, app, highlights }

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
  todoHighlighted: Events.clientOnly({
    name: 'todo.highlighted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  'todo.created': ({ id, text, completed }) => tables.todos.insert({ id, text, completed }),
  'todo.completed': ({ id }) => tables.todos.update({ completed: true }).where({ id }),
  'todo.highlighted': ({ id }) => tables.highlights.insert({ todoId: id }),
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
  /** Returns no events when the todo already exists (for NoEventProduced replay testing). */
  createTodoIfNotExists: defineCommand({
    name: 'CreateTodoIfNotExists',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    handler: ({ id, text }, ctx) => {
      const existing = ctx.query(tables.todos.where({ id }).first())
      if (existing !== undefined) return [] as const
      return events.todoCreated({ id, text, completed: false })
    },
  }),
  /** Succeeds on initial execution but throws on replay (for CommandHandlerThrew replay testing). */
  throwOnReplay: defineCommand({
    name: 'ThrowOnReplay',
    schema: Schema.Struct({ id: Schema.String }),
    handler: ({ id }, ctx) => {
      if (ctx.phase._tag === 'replay') throw new Error('Replay not supported')
      return events.todoCreated({ id, text: 'from throwOnReplay', completed: false })
    },
  }),
  /** Completes all incomplete todos. Event count depends on current state — useful for replay-count-mismatch testing. */
  completeAllTodos: defineCommand({
    name: 'CompleteAllTodos',
    schema: Schema.Struct({}),
    handler: (_, ctx) => {
      const rows = ctx.query({ query: 'SELECT id FROM todos WHERE completed = 0 ORDER BY id', bindValues: {} }) as Array<{ id: string }>
      return rows.map(({ id }) => events.todoCompleted({ id }))
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
  /** Returns a single event wrapped in an array (for testing array-of-one equivalence with bare event). */
  createTodoWrapped: defineCommand({
    name: 'CreateTodoWrapped',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    handler: ({ id, text }) => [events.todoCreated({ id, text, completed: false })],
  }),
  /** Uses ctx.query with a query builder to read a todo and derive a new one from it. */
  queryBuilderRead: defineCommand({
    name: 'QueryBuilderRead',
    schema: Schema.Struct({ id: Schema.String, suffix: Schema.String }),
    handler: ({ id, suffix }, ctx) => {
      const todo = ctx.query(tables.todos.where({ id }).first()) as { text: string } | undefined
      if (todo === undefined) throw new Error(`Todo ${id} not found`)
      return events.todoCreated({ id: `${id}-derived`, text: `${todo.text}-${suffix}`, completed: false })
    },
  }),
  /** Creates multiple todos, checking uniqueness of each. Returns TodoAlreadyExists if any exists. */
  createMultipleTodosUnique: defineCommand({
    name: 'CreateMultipleTodosUnique',
    schema: Schema.Struct({
      todos: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
    }),
    handler: ({ todos }, ctx) => {
      for (const { id } of todos) {
        const existing = ctx.query(tables.todos.where({ id }).first())
        if (existing !== undefined) return new TodoAlreadyExists()
      }
      return todos.map(({ id, text }) => events.todoCreated({ id, text, completed: false }))
    },
  }),
  /** Produces both a synced event and a client-only event. */
  createAndHighlightTodo: defineCommand({
    name: 'CreateAndHighlightTodo',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
    handler: ({ id, text }) => [
      events.todoCreated({ id, text, completed: false }),
      events.todoHighlighted({ id }),
    ],
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
