/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet exposes intermediate streams */
// ---cut---
import { queryDb, signal } from '@livestore/livestore'
import { tables } from '../framework-integrations/react/schema.ts'

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
