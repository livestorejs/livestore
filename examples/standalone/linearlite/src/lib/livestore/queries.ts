import { tables } from '@/lib/livestore/schema'
import { queryDb, SessionIdSymbol } from '@livestore/livestore'
import { useClientDocument } from '@livestore/react'

export const useFilterState = () => useClientDocument(tables.filterState, SessionIdSymbol)
export const useScrollState = () => useClientDocument(tables.scrollState, SessionIdSymbol)
export const useFrontendState = () => useClientDocument(tables.frontendState, 'default')

export const issueCount$ = queryDb(tables.issue.count().where({ deleted: null }), { label: 'global.issueCount' })
export const highestIssueId$ = queryDb(tables.issue.select('id').orderBy('id', 'desc').limit(1), {
  label: 'global.highestIssueId',
})
export const highestKanbanOrder$ = queryDb(tables.issue.select('kanbanorder').orderBy('kanbanorder', 'desc').limit(1), {
  label: 'global.highestKanbanOrder',
})
export const filterState$ = queryDb(tables.filterState.get(), { label: 'global.filterState' })
