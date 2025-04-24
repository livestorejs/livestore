import { makeSchema, State } from '@livestore/livestore'

import * as events from './events.js'
import { materializers } from './materializers.js'
import * as tables from './tables.js'

const state = State.SQLite.makeState({ tables, materializers })

// Export final schema based on events and state
export const schema = makeSchema({ events, state })

// Re-export `events` and `tables` for convenience
export * as events from './events.js'
export * as tables from './tables.js'
