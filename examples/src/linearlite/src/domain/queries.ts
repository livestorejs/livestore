import { filterStateTable, tables } from './schema'
import { useRow, useStore } from '@livestore/react'
import { querySQL, rowQuery, SessionIdSymbol } from '@livestore/livestore'

export const useFilterState = () => {
  const { store } = useStore()
  return useRow(filterStateTable, store.sessionId)
}

export const issueCount$ = querySQL(tables.issue.query.count(), { label: 'global.issueCount' })
export const filterState$ = rowQuery(tables.filterState, SessionIdSymbol, { label: 'global.filterState' })
