import { Schema, SessionIdSymbol, State } from '@livestore/livestore'

const Theme = Schema.Literals(['dark', 'light', 'system']).annotate({ title: 'Theme' })
export type Theme = typeof Theme.Type

export const FrontendState = Schema.Struct({
  theme: Theme,
  user: Schema.String,
  showToolbar: Schema.Boolean,
})
export type FrontendState = typeof FrontendState.Type

export const defaultFrontendState: FrontendState = { theme: 'system', user: 'John Doe', showToolbar: true }

export const frontendState = State.SQLite.clientDocument({
  name: 'frontend_state',
  schema: FrontendState,
  default: { value: defaultFrontendState, id: SessionIdSymbol },
})
