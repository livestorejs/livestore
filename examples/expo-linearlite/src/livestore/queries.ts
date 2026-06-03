import { queryDb } from '@livestore/livestore'

import { defaultUiState, tables } from './schema.ts'

export const uiState$ = queryDb(
  tables.uiState
    .select('value')
    .where({ id: 'default' })
    .first({ behaviour: 'fallback', fallback: () => defaultUiState }),
  { label: 'uiState' },
)
