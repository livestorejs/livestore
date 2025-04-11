import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { provideOtel } from '@livestore/common'
import { createStore, makeSchema, State } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

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

export const state = State.SQLite.makeState({ tables, materializers: {} })
export const schema = makeSchema({ state, events: {} })

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
  }).pipe(provideOtel({ parentSpanContext: otelContext, otelTracer: otelTracer }))
