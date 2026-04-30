import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const uiState$ = queryDb(tables.uiState.get(), { label: 'uiState' })

export const visibleTodos$ = queryDb(
  (get) => {
    const { filter } = get(uiState$)

    return tables.todos.where({
      deletedAt: null,
      completed: filter === 'all' ? undefined : filter === 'completed',
    })
  },
  { label: 'visibleTodos' },
)
