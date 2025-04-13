import { tables } from '@/lib/livestore/schema'
import { queryDb } from '@livestore/livestore'
import { useClientDocument } from '@livestore/react'
import React from 'react'

export const useFilterState = () => useClientDocument(tables.filterState)

export const useDebouncedScrollState = (id: string, { debounce = 100 }: { debounce?: number } = {}) => {
  const [initialState, setPersistedState] = useClientDocument(tables.scrollState, id)
  const [state, setReactState] = React.useState(initialState)

  const debounceTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  const setState = React.useCallback(
    (state: typeof initialState) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }

      debounceTimeoutRef.current = setTimeout(() => {
        setPersistedState(state)
        setReactState(state)
      }, debounce)
    },
    [setPersistedState, debounce],
  )

  return [state, setState] as const
}

export const useFrontendState = () => useClientDocument(tables.frontendState)

export const issueCount$ = queryDb(tables.issue.count().where({ deleted: null }), { label: 'global.issueCount' })
export const highestIssueId$ = queryDb(
  tables.issue
    .select('id')
    .orderBy('id', 'desc')
    .first({ fallback: () => 0 }),
  {
    label: 'global.highestIssueId',
  },
)
export const highestKanbanOrder$ = queryDb(
  tables.issue
    .select('kanbanorder')
    .orderBy('kanbanorder', 'desc')
    .first({ fallback: () => 'a1' }),
  {
    label: 'global.highestKanbanOrder',
  },
)
export const filterState$ = queryDb(tables.filterState.get(), { label: 'global.filterState' })
