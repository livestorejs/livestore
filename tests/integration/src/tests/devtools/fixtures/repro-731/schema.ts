import { makeSchema, State } from '@livestore/livestore'

export const schema = makeSchema({
  events: {},
  state: State.SQLite.makeState({
    tables: {},
    materializers: {},
  }),
})
