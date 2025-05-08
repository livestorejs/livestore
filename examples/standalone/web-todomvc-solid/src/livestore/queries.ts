import { queryDb } from '@livestore/livestore'

import { tables } from './schema.js'

export const uiState$ = queryDb(tables.uiState.get(), { label: 'uiState' })
