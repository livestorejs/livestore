import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const todos$ = queryDb(
  tables.todos.select().orderBy([{ col: 'id', direction: 'asc' }]),
  { label: 'todos' },
)

export const uiState$ = queryDb(tables.uiState.get(), { label: 'uiState' })
