import { queryDb, SessionIdSymbol } from '@livestore/livestore'
import { useRow } from '@livestore/react'
import { tables } from './schema'

export const useFilterState = () => useRow(tables.filterState, SessionIdSymbol)

export const issueCount$ = queryDb(tables.issue.query.count().where({ deleted: null }), { label: 'global.issueCount' })
export const filterState$ = queryDb(tables.filterState.query.row(SessionIdSymbol), { label: 'global.filterState' })
