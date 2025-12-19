import { Events, makeSchema, Schema, State } from '@livestore/livestore'

export const tables = {
  counter: State.SQLite.clientDocument({
    name: 'Counter',
    schema: Schema.Struct({ value: Schema.Number }),
    default: { value: { value: 0 } },
  }),
} as const

export const events = {} as const

const materializers = State.SQLite.materializers(events, {})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })