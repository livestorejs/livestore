import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const uiState$ = queryDb(
  tables.uiState
    .select('newTodoText', 'filter')
    .where({ id: 'default' })
    .first({ behaviour: 'fallback', fallback: () => ({ newTodoText: '', filter: 'all' }) }),
  { label: 'app' },
)
