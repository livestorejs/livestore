/** Import via Vite alias to reproduce issue #938 */

import { makeSchema, State } from '@livestore/livestore'
import { formatDate } from '@/utils'

// Use the import to ensure it's not tree-shaken
const _unused = formatDate

export const schema = makeSchema({
  events: {},
  state: State.SQLite.makeState({
    tables: {},
    materializers: {},
  }),
})
