import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { provideOtel } from '@livestore/common'
import type { FromInputSchema } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import { createStore, DbSchema, makeSchema } from '@livestore/livestore'
import { Effect } from '@livestore/utils/effect'
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

export const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '', nullable: false }),
    completed: DbSchema.boolean({ default: false, nullable: false }),
  },
  { deriveMutations: true, isSingleton: false },
)

export const app = DbSchema.table(
  'app',
  {
    id: DbSchema.text({ primaryKey: true, default: 'static' }),
    newTodoText: DbSchema.text({ default: '', nullable: true }),
    filter: DbSchema.text({ default: 'all', nullable: false }),
  },
  { isSingleton: true },
)

export const tables = { todos, app }
export const schema = makeSchema({ tables })

export interface FixtureSchema extends FromInputSchema.DeriveSchema<{ tables: typeof tables }> {}

export const makeTodoMvc = ({
  otelTracer,
  otelContext,
}: {
  otelTracer?: otel.Tracer
  otelContext?: otel.Context
} = {}) =>
  Effect.gen(function* () {
    const store: Store<FixtureSchema> = yield* createStore({
      schema,
      storeId: 'default',
      adapter: makeInMemoryAdapter(),
      debug: { instanceId: 'test' },
    })

    return store
  }).pipe(provideOtel({ parentSpanContext: otelContext, otelTracer: otelTracer }))
