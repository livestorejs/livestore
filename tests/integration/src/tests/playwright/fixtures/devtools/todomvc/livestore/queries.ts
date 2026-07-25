import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const uiStateQuery = (id: string) =>
  queryDb(
    tables.uiState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, newTodoText: '', filter: 'all' as const }),
    }),
    { label: `app:${id}`, deps: id },
  )
