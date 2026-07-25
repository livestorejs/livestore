import React from 'react'

import { queryDb } from '@livestore/livestore'

import {
  defaultFilterState,
  defaultFrontendState,
  defaultScrollState,
  events,
  type FilterState,
  type FrontendState,
  tables,
} from './schema/index.ts'
import { useAppStore } from './store.ts'

export const useFilterState = () => {
  const appStore = useAppStore()
  const id = appStore.sessionId
  const { value } = appStore.useQuery(filterStateQuery(id))
  const setState = React.useCallback(
    (patch: Partial<FilterState>) => appStore.commit(events.filterStateChanged({ id, value: { ...value, ...patch } })),
    [appStore, id, value],
  )

  return [value, setState] as const
}

export const useDebouncedScrollState = (id: string, { debounce = 100 }: { debounce?: number } = {}) => {
  const appStore = useAppStore()
  const { value: initialState } = appStore.useQuery(scrollStateQuery(id))
  const [state, setReactState] = React.useState(initialState)

  const debounceTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const setState = React.useCallback(
    (state: typeof initialState) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }

      debounceTimeoutRef.current = setTimeout(() => {
        appStore.commit(events.scrollStateChanged({ id, value: state }))
        setReactState(state)
      }, debounce)
    },
    [appStore, debounce, id],
  )

  return [state, setState] as const
}

export const useFrontendState = () => {
  const appStore = useAppStore()
  const id = appStore.sessionId
  const { value } = appStore.useQuery(frontendStateQuery(id))
  const setState = React.useCallback(
    (patch: Partial<FrontendState>) =>
      appStore.commit(events.frontendStateChanged({ id, value: { ...value, ...patch } })),
    [appStore, id, value],
  )

  return [value, setState] as const
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
export const filterStateQuery = (id: string) =>
  queryDb(
    tables.filterState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, value: defaultFilterState }),
    }),
    { label: `global.filterState:${id}`, deps: id },
  )

const frontendStateQuery = (id: string) =>
  queryDb(
    tables.frontendState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, value: defaultFrontendState }),
    }),
    { label: `global.frontendState:${id}`, deps: id },
  )

const scrollStateQuery = (id: string) =>
  queryDb(
    tables.scrollState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, value: defaultScrollState }),
    }),
    { label: `global.scrollState:${id}`, deps: id },
  )
