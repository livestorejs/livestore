import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const todos$ = queryDb(tables.todos.select().orderBy([{ col: 'id', direction: 'asc' }]), { label: 'todos' })

export const uiStateQuery = (id: string) =>
  queryDb(
    tables.uiState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, newTodoText: '', filter: 'all' as const }),
    }),
    { label: `uiState:${id}`, deps: id },
  )
