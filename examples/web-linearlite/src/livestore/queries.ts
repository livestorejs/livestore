import { queryDb } from '@livestore/livestore'
import { useClientDocument } from '@livestore/react'
import React from 'react'
import { tables } from './schema/index.ts'
import { useAppStore } from './store.ts'

export const useFilterState = () => {
  const appStore = useAppStore()
  return appStore.useClientDocument(tables.filterState)
}

export const useDebouncedScrollState = (id: string, { debounce = 100 }: { debounce?: number } = {}) => {
  const appStore = useAppStore()
  const [initialState, setPersistedState] = appStore.useClientDocument(tables.scrollState, id)
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

export const useFrontendState = () => {
  const appStore = useAppStore()
  return appStore.useClientDocument(tables.frontendState)
}

export const issueCount$ = queryDb(tables.issue.count().where({ deleted: null }), { label: 'global.issueCount' })
export const highestIssueId$ = queryDb(
  tables.issue
    .select('id')
    .orderBy('id', 'desc')
    .first({ behaviour: 'fallback', fallback: () => 0 }),
  {
    label: 'global.highestIssueId',
  },
)
export const highestKanbanOrder$ = queryDb(
  tables.issue
    .select('kanbanorder')
    .orderBy('kanbanorder', 'desc')
    .first({ behaviour: 'fallback', fallback: () => 'a1' }),
  {
    label: 'global.highestKanbanOrder',
  },
)
export const filterState$ = queryDb(tables.filterState.get(), { label: 'global.filterState' })
