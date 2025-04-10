import { queryDb, SessionIdSymbol } from '@livestore/livestore'

import { tables } from './schema.js'

export const uiState$ = queryDb(tables.uiState.get(SessionIdSymbol), { label: 'app' })
