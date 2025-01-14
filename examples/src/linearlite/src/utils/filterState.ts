import { QueryBuilder } from '@livestore/livestore'
import { Schema } from 'effect'
import { useSearchParams } from 'react-router-dom'
import { FilterState, tables } from '../lib/livestore/schema'

export function useFilterState(): [FilterState, (state: Partial<FilterState>) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const orderBy = searchParams.get('orderBy') ?? 'created'
  const orderDirection = (searchParams.get('orderDirection') as 'asc' | 'desc') ?? 'desc'
  const status = searchParams
    .getAll('status')
    .map((status) => status.toLocaleLowerCase().split(','))
    .flat()
  const priority = searchParams
    .getAll('priority')
    .map((status) => status.toLocaleLowerCase().split(','))
    .flat()
  const query = searchParams.get('query') ?? undefined

  const state = Schema.decodeUnknownSync(FilterState)({
    orderBy,
    orderDirection,
    status,
    priority,
    query,
  })

  const setState = (state: Partial<FilterState>) => {
    const { orderBy, orderDirection, status, priority, query } = state
    setSearchParams((searchParams) => {
      if (orderBy) {
        searchParams.set('orderBy', orderBy)
      } else {
        searchParams.delete('orderBy')
      }
      if (orderDirection) {
        searchParams.set('orderDirection', orderDirection)
      } else {
        searchParams.delete('orderDirection')
      }
      if (status && status.length > 0) {
        searchParams.set('status', status.join(','))
      } else {
        searchParams.delete('status')
      }
      if (priority && priority.length > 0) {
        searchParams.set('priority', priority.join(','))
      } else {
        searchParams.delete('priority')
      }
      if (query) {
        searchParams.set('query', query)
      } else {
        searchParams.delete('query')
      }
      return searchParams
    })
  }

  return [state, setState]
}

export const filterStateToWhere = (filterState: FilterState) => {
  const { status, priority, query } = filterState

  return {
    status: status ? { op: 'IN', value: status } : undefined,
    priority: priority ? { op: 'IN', value: priority } : undefined,
    // TODO treat query as `OR` in
    title: query ? { op: 'LIKE', value: `%${query}%` } : undefined,
  } satisfies QueryBuilder.WhereParams<typeof tables.issue>
}

export const filterStateToOrderBy = (filterState: FilterState) => [
  { col: filterState.orderBy, direction: filterState.orderDirection },
]
