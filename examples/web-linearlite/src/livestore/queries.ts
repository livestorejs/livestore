import React from 'react'

import { queryDb } from '@livestore/livestore'

import { defaultFilterState, defaultFrontendState, defaultScrollState, events, tables } from './schema/index.ts'
import { useAppStore } from './store.ts'

export const useFilterState = () => {
  const appStore = useAppStore()
  const state = appStore.useQuery(filterState$)
  const setState = React.useCallback(
    (value: typeof defaultFilterState) => appStore.commit(events.filterStateSet({ id: 'default', value })),
    [appStore],
  )
  return [state, setState] as const
}

export const useDebouncedScrollState = (id: string, { debounce = 100 }: { debounce?: number } = {}) => {
  const appStore = useAppStore()
  const scrollState$ = React.useMemo(
    () =>
      queryDb(
        tables.scrollState
          .select('value')
          .where({ id })
          .first({ behaviour: 'fallback', fallback: () => defaultScrollState }),
        { label: `scrollState:${id}`, deps: [id] },
      ),
    [id],
  )
  const initialState = appStore.useQuery(scrollState$)
  const setPersistedState = React.useCallback(
    (value: typeof defaultScrollState) => appStore.commit(events.scrollStateSet({ id, value })),
    [appStore, id],
  )
  const [state, setReactState] = React.useState(initialState)

  const debounceTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const frontendState$ = React.useMemo(
    () =>
      queryDb(
        tables.frontendState
          .select('value')
          .where({ id: 'default' })
          .first({ behaviour: 'fallback', fallback: () => defaultFrontendState }),
        { label: 'frontendState' },
      ),
    [],
  )
  const state = appStore.useQuery(frontendState$)
  const setState = React.useCallback(
    (value: typeof defaultFrontendState) => appStore.commit(events.frontendStateSet({ id: 'default', value })),
    [appStore],
  )
  return [state, setState] as const
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
export const filterState$ = queryDb(
  tables.filterState
    .select('value')
    .where({ id: 'default' })
    .first({ behaviour: 'fallback', fallback: () => defaultFilterState }),
  { label: 'global.filterState' },
)
