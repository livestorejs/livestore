import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const uiState$ = queryDb(tables.uiState.get(), { label: 'uiState' })

export const allItems$ = queryDb(tables.items.select(), { label: 'allItems' })
