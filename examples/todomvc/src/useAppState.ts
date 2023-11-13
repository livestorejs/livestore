import { querySQL, sql } from '@livestore/livestore'
import { useQuery } from '@livestore/livestore/react'

import type { AppState } from './schema.js'

const appState = querySQL<AppState>(sql`SELECT newTodoText, filter FROM app;`, { queriedTables: ['app'] }).getFirstRow()

export const useAppState = () => useQuery(appState)
