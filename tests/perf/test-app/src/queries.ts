import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const uiState$ = queryDb(
  tables.uiState
    .select()
    .where({ id: 'default' })
    .first({ behaviour: 'fallback', fallback: () => ({ id: 'default', selected: null }) }),
  { label: 'uiState' },
)

export const allItems$ = queryDb(tables.items.select(), { label: 'allItems' })
