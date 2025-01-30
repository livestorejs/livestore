import { tables } from '@/lib/livestore/schema'
import { queryDb, SessionIdSymbol } from '@livestore/livestore'
import { useRow } from '@livestore/react'

export const useFilterState = () => useRow(tables.filterState, SessionIdSymbol)
export const useScrollState = () => useRow(tables.scrollState, SessionIdSymbol)
export const useFrontendState = () => useRow(tables.frontendState, 'default')

export const issueCount$ = queryDb(tables.issue.query.count().where({ deleted: null }), { label: 'global.issueCount' })
export const highestIssueId$ = queryDb(tables.issue.query.select('id').orderBy('id', 'desc').limit(1), {
  label: 'global.highestIssueId',
})
export const filterState$ = queryDb(tables.filterState.query.row(SessionIdSymbol), { label: 'global.filterState' })
