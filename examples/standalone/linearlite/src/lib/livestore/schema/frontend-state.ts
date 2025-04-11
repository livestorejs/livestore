import { State, Schema } from '@livestore/livestore'

const Theme = Schema.Literal('dark', 'light', 'system').annotations({ title: 'Theme' })
export type Theme = typeof Theme.Type

export const FrontendState = Schema.Struct({
  theme: Theme,
  user: Schema.String,
  showToolbar: Schema.Boolean,
})
export type FrontendState = typeof FrontendState.Type

export const defaultFrontendState: FrontendState = { theme: 'system', user: 'John Doe', showToolbar: true }

export const frontendState = State.SQLite.table(
  'frontend_state',
  State.SQLite.json({ schema: FrontendState, default: defaultFrontendState }),
  { deriveEvents: true },
)
