import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

const defaultUiState = { newTodoText: '', filter: 'all' as const }

/** Returns an in-memory fallback without writing when this session has no persisted UI state yet. */
export const uiStateQuery = (id: string) =>
  queryDb(
    tables.uiState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, ...defaultUiState }),
    }),
    { label: `uiState:${id}`, deps: id },
  )
