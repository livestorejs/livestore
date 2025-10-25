/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet exposes intermediate streams */
// ---cut---
import { queryDb, State, signal } from '@livestore/livestore'

const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
      completed: State.SQLite.boolean({ default: false }),
      createdAt: State.SQLite.datetime(),
    },
  }),
} as const

const uiState$ = signal({ showCompleted: false }, { label: 'uiState$' })

const todos$ = queryDb(tables.todos.orderBy('createdAt', 'desc'), { label: 'todos$' })

{
  const todos$ = queryDb(
    (get) => {
      const { showCompleted } = get(uiState$)
      return tables.todos.where(showCompleted ? { completed: true } : {})
    },
    { label: 'todos$' },
  )
}
