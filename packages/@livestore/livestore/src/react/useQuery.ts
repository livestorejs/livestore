import * as otel from '@opentelemetry/api'
import { isEqual } from 'lodash-es'
import React from 'react'

import { labelForKey } from '../componentKey.js'
import type { QueryDefinition } from '../effect/LiveStore.js'
import type { ILiveStoreQuery } from '../reactiveQueries/base-class.js'
import type { LiveStoreQuery, QueryResult, Store } from '../store.js'
import { useStore } from './LiveStoreContext.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

export const useQuery = <TResult>(query: ILiveStoreQuery<TResult>): TResult => {
  const { store } = useStore()
  // const query = React.useMemo(() => {
  //   if (queryCache.has(queryDef)) return queryCache.get(queryDef) as Q

  //   const query = queryDef(store)
  //   queryCache.set(queryDef, query)
  //   return query
  // }, [store, queryDef])

  // TODO proper otel context
  const initialResult = React.useMemo(() => query.results$.computeResult(), [query])

  // We know the query has a result by the time we use it; so we can synchronously populate a default state
  const [valueRef, setValue] = useStateRefWithReactiveInput<TResult>(initialResult)

  // Subscribe to future updates for this query
  React.useEffect(() => {
    return store.otel.tracer.startActiveSpan(
      `LiveStore:useQuery:${query.label}`,
      // `LiveStore:useQuery:${labelForKey(query.componentKey)}:${query.label}`,
      { attributes: { label: query.label } },
      query.otelContext,
      (span) => {
        const cancel = store.subscribe(
          query,
          (v) => {
            // NOTE: we return a reference to the result object within LiveStore;
            // this implies that app code must not mutate the results, or else
            // there may be weird reactivity bugs.
            if (isEqual(v, valueRef.current) === false) {
              setValue(v)
            }
          },
          undefined,
          { label: query.label },
        )
        return () => {
          // // NOTE destroying the whole query will also unsubscribe it
          // query.destroy()

          // TODO for now we'll still `cancel` manually, but we should remove this once we have some kind of
          // ARC-based system
          cancel()
          span.end()
        }
      },
    )
  }, [query, setValue, store, valueRef])

  return valueRef.current
}
