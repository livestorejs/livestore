import { Schema } from '@livestore/utils/effect'

import { makeSchema, State } from '../schema/mod.js'

export const UiState = State.SQLite.clientDocument({
  name: 'UiState',
  schema: Schema.Struct({
    showSidebar: Schema.Boolean,
  }),
  default: {
    value: { showSidebar: true },
  },
})

const Config = Schema.Struct({
  fontSize: Schema.Number,
  theme: Schema.Literal('light', 'dark'),
})

export const appConfig = State.SQLite.clientDocument({
  name: 'AppConfig',
  schema: Config,
  default: {
    id: 'static',
    value: { fontSize: 13, theme: 'light' },
  },
})

const events = {
  uiStateSet: UiState.set,
  appConfigSet: appConfig.set,
}

export const tables = { UiState, appConfig }

const state = State.SQLite.makeState({ tables, materializers: {} })

export const schema = makeSchema({ state, events })
