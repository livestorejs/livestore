import { useSearchParams } from 'react-router-dom'
import { FilterState } from '../domain/schema'
import { Schema } from 'effect'

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

export function filterStateToWhere(filterState: FilterState) {
  const { status, priority, query } = filterState
  let where = 'WHERE '
  const orig = where
  if (status && status.length > 0) {
    where += `STATUS IN (${status.map((s) => "'" + s + "'").join(',')})`
  }
  if (priority && priority.length > 0) {
    if (where !== orig) {
      where += ' AND '
    }
    where += `PRIORITY IN (${priority.map((s) => "'" + s + "'").join(',')})`
  }
  if (query) {
    // TODO: description search too?
    if (where !== orig) {
      where += ' OR '
    }
    where += `TITLE LIKE '%${query}%'`
  }
  if (where === orig) {
    return ''
  }
  return where
}

export function filterStateToOrder(filterState: FilterState) {
  if (filterState.orderBy) {
    return `ORDER BY ${filterState.orderBy} ${filterState.orderDirection || 'desc'}`
  }

  return ''
}
