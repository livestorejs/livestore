import { makeSchema, State } from '@livestore/livestore'

import * as sqlEvents from './events.js'
import { materializers } from './materializers.js'
import * as sqlTables from './tables.js'
import * as uiDocuments from './ui.js'

const events = {
  ...sqlEvents,
  setFilterFoods: uiDocuments.filterFoodsDocument.set,
}
const tables = { ...sqlTables, ...uiDocuments }

const state = State.SQLite.makeState({ tables, materializers })

export { events, tables }
export const schema = makeSchema({ events, state })
