import { isEqual } from 'lodash-es'
import React from 'react'

import type { ILiveStoreQuery } from '../reactiveQueries/base-class.js'
import { useStore } from './LiveStoreContext.js'
import { extractStackInfoFromStackTrace, originalStackLimit } from './utils/extractStackInfoFromStackTrace.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

export const useQuery = <TResult>(query: ILiveStoreQuery<TResult>): TResult => {
  const { store } = useStore()

  // TODO proper otel context
  const initialResult = React.useMemo(() => query.run(), [query])

  // We know the query has a result by the time we use it; so we can synchronously populate a default state
  const [valueRef, setValue] = useStateRefWithReactiveInput<TResult>(initialResult)

  const subscriptionInfo = React.useMemo(() => {
    Error.stackTraceLimit = 10
    // eslint-disable-next-line unicorn/error-message
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return { stack: extractStackInfoFromStackTrace(stack) }
  }, [])

  // Subscribe to future updates for this query
  React.useEffect(() => {
    return store.otel.tracer.startActiveSpan(
      `LiveStore:useQuery:${query.label}`,
      // `LiveStore:useQuery:${labelForKey(query.componentKey)}:${query.label}`,
      { attributes: { label: query.label } },
      store.otel.queriesSpanContext,
      (span) => {
        query.activeSubscriptions.add(subscriptionInfo)
        const unsub = store.subscribe(
          query,
          (newValue) => {
            // NOTE: we return a reference to the result object within LiveStore;
            // this implies that app code must not mutate the results, or else
            // there may be weird reactivity bugs.
            if (isEqual(newValue, valueRef.current) === false) {
              setValue(newValue)
            }
          },
          undefined,
          { label: query.label },
        )
        return () => {
          query.activeSubscriptions.delete(subscriptionInfo)
          unsub()
          span.end()
        }
      },
    )
  }, [subscriptionInfo, query, setValue, store, valueRef])

  return valueRef.current
}
