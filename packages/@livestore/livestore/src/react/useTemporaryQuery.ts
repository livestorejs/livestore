import React from 'react'

import type { LiveQuery } from '../reactiveQueries/base-class.js'
import { useQueryRef } from './useQuery.js'
import { useCleanup } from './utils/useCleanup.js'

/**
 * This is needed because the `React.useMemo` call below, can sometimes be called multiple times 🤷.
 * The map entry is being removed again in the `React.useEffect` call below.
 */
const queryCache = new Map<() => LiveQuery<any>, { reactIds: Set<string>; query$: LiveQuery<any> }>()

/**
 * Creates a query, subscribes and destroys it when the component unmounts.
 *
 * Make sure `makeQuery` is a memoized function.
 */
export const useTemporaryQuery = <TResult>(makeQuery: () => LiveQuery<TResult>): TResult =>
  useTemporaryQueryRef(makeQuery).current

export const useTemporaryQueryRef = <TResult>(makeQuery: () => LiveQuery<TResult>): React.MutableRefObject<TResult> => {
  const reactId = React.useId()

  const query$ = React.useMemo(() => {
    const cachedItem = queryCache.get(makeQuery)
    if (cachedItem !== undefined) {
      cachedItem.reactIds.add(reactId)

      return cachedItem.query$
    }

    const query$ = makeQuery()

    queryCache.set(makeQuery, { reactIds: new Set([reactId]), query$ })

    return query$
  }, [reactId, makeQuery])

  useCleanup(
    React.useCallback(() => {
      const cachedItem = queryCache.get(makeQuery)!

      cachedItem.reactIds.delete(reactId)

      if (cachedItem.reactIds.size === 0) {
        cachedItem.query$.destroy()
        queryCache.delete(makeQuery)
      }
    }, [makeQuery, reactId]),
  )

  return useQueryRef(query$)
}
