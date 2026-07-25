import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const uiStateQuery = (id: string) =>
  queryDb(
    tables.uiState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, selected: null }),
    }),
    { label: `uiState:${id}`, deps: id },
  )

export const allItems$ = queryDb(tables.items.select(), { label: 'allItems' })
