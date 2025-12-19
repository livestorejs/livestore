import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

export const tables = {
  uiState: State.SQLite.clientDocument({
    name: 'UiState',
    schema: Schema.Struct({
      newTodoText: Schema.String,
      filter: Schema.Literal('all', 'active', 'completed'),
    }),
    default: { id: SessionIdSymbol, value: { newTodoText: '', filter: 'all' } },
  }),
  kv: State.SQLite.clientDocument({
    name: 'Kv',
    schema: Schema.Any,
    default: { value: null },
  }),
} as const

export const events = {} as const

const materializers = State.SQLite.materializers(events, {})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
