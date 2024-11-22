import { tables } from './schema'
import { useRow } from '@livestore/react'
import { queryDb, SessionIdSymbol } from '@livestore/livestore'

export const useFilterState = () => useRow(tables.filterState, SessionIdSymbol)

export const issueCount$ = queryDb(tables.issue.query.count(), { label: 'global.issueCount' })
export const filterState$ = queryDb(tables.filterState.query.row(SessionIdSymbol), { label: 'global.filterState' })
