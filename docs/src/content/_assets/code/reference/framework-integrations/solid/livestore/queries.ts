import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

const defaultUiState = { newTodoText: '', filter: 'all' as const }

export const uiStateQuery = (id: string) =>
  queryDb(
    tables.uiState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, ...defaultUiState }),
    }),
    { label: `uiState:${id}`, deps: id },
  )

export const visibleTodosQuery = (id: string) =>
  queryDb(
    (get) => {
      const { filter } = get(uiStateQuery(id))

      return tables.todos.where({
        deletedAt: null,
        completed: filter === 'all' ? undefined : filter === 'completed',
      })
    },
    { label: `visibleTodos:${id}`, deps: id },
  )
