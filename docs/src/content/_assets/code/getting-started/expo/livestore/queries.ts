import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const uiState$ = queryDb(
  tables.uiState
    .select('newTodoText', 'filter')
    .where({ id: 'default' })
    .first({ behaviour: 'fallback', fallback: () => ({ newTodoText: '', filter: 'all' }) }),
  { label: 'uiState' },
)

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
