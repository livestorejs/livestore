import { makeSchema, State } from '../schema/mod.ts'

export const UiState = State.SQLite.table({
  name: 'UiState',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    showSidebar: State.SQLite.boolean({ default: true }),
  },
})

export const appConfig = State.SQLite.table({
  name: 'AppConfig',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    fontSize: State.SQLite.integer({ default: 13 }),
    theme: State.SQLite.text({ default: 'light' }),
  },
})

const events = {}

export const tables = { UiState, appConfig }

const state = State.SQLite.makeState({ tables, materializers: {} })

export const schema = makeSchema({ state, events })
