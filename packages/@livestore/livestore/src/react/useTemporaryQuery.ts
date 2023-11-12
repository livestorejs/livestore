import React from 'react'

import type { ILiveStoreQuery } from '../reactiveQueries/base-class.js'
import { useQuery } from './useQuery.js'

/**
 * Creates a query, subscribes and destroys it when the component unmounts.
 *
 * Make sure `makeQuery` is a memoized function.
 */
export const useTemporaryQuery = <TResult>(makeQuery: () => ILiveStoreQuery<TResult>): TResult => {
  // TODO cache the query outside of the `useMemo` since `useMemo` might be called multiple times
  // also need to update the `useEffect` below https://stackoverflow.com/questions/66446642/react-usememo-memory-clean/77457605#77457605
  const query = React.useMemo(() => makeQuery(), [makeQuery])

  React.useEffect(() => {
    return () => {
      query.destroy()
    }
  }, [query])

  return useQuery(query)
}
