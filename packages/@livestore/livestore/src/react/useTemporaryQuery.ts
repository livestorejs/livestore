import type { QueryInfo } from '@livestore/common'
import * as otel from '@opentelemetry/api'
import React from 'react'

import type { LiveQuery } from '../reactiveQueries/base-class.js'
import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'

// NOTE Given `useMemo` will be called multiple times (e.g. when using React Strict mode or Fast Refresh),
// we are using this cache to avoid starting multiple queries/spans for the same component.
// This is somewhat against some recommended React best practices, but it should be fine in our case below.
// Please definitely open an issue if you see or run into any problems with this approach!
const cache = new Map<
  string,
  {
    rc: number
    query$: LiveQuery<any, any>
    span: otel.Span
    otelContext: otel.Context
  }
>()

export type DepKey = string | number | ReadonlyArray<string | number>

/**
 * Creates a query, subscribes and destroys it when the component unmounts.
 *
 * The `key` is used to determine whether the a new query should be created or if the existing one should be reused.
 */
export const useTemporaryQuery = <TResult>(makeQuery: () => LiveQuery<TResult>, key: DepKey): TResult =>
  useTemporaryQueryRef(makeQuery, key).current

export const useTemporaryQueryRef = <TResult>(
  makeQuery: () => LiveQuery<TResult>,
  key: DepKey,
): React.MutableRefObject<TResult> => {
  const { query$ } = useMakeTemporaryQuery(makeQuery, key)

  return useQueryRef(query$)
}

export const useMakeTemporaryQuery = <TResult, TQueryInfo extends QueryInfo>(
  makeQuery: (otelContext: otel.Context) => LiveQuery<TResult, TQueryInfo>,
  key: DepKey,
  options?: {
    otel?: {
      spanName?: string
      attributes?: otel.Attributes
    }
  },
): { query$: LiveQuery<TResult, TQueryInfo>; otelContext: otel.Context } => {
  const { store } = useStore()
  const fullKey = React.useMemo(
    // NOTE We're using the `makeQuery` function body string to make sure the key is unique across the app
    // TODO we should figure out whether this could cause some problems and/or if there's a better way to do this
    () => (Array.isArray(key) ? key.join('-') : key) + '-' + store.graph.id + '-' + makeQuery.toString(),
    [key, makeQuery, store.graph.id],
  )
  const fullKeyRef = React.useRef<string>()

  const { query$, otelContext } = React.useMemo(() => {
    if (fullKeyRef.current !== undefined && fullKeyRef.current !== fullKey) {
      // console.debug('fullKey changed, destroying previous', fullKeyRef.current.split('-')[0]!, fullKey.split('-')[0]!)

      const cachedItem = cache.get(fullKeyRef.current)
      if (cachedItem !== undefined) {
        cachedItem.rc--

        if (cachedItem.rc === 0) {
          cachedItem.query$.destroy()
          cachedItem.span.end()
          cache.delete(fullKeyRef.current)
        }
      }
    }

    const cachedItem = cache.get(fullKey)
    if (cachedItem !== undefined) {
      cachedItem.rc++

      return cachedItem
    }

    const spanName = options?.otel?.spanName ?? `LiveStore:useTemporaryQuery:${key}`

    const span = store.otel.tracer.startSpan(
      spanName,
      { attributes: options?.otel?.attributes },
      store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const query$ = makeQuery(otelContext)

    cache.set(fullKey, { rc: 1, query$, span, otelContext })

    return { query$, otelContext }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  fullKeyRef.current = fullKey

  React.useEffect(() => {
    return () => {
      const cachedItem = cache.get(fullKey)
      // NOTE in case the fullKey changed then the query was already destroyed in the useMemo above
      if (cachedItem === undefined) return

      cachedItem.rc--

      if (cachedItem.rc === 0) {
        cachedItem.query$.destroy()
        cachedItem.span.end()
        cache.delete(fullKey)
      }
    }
  }, [fullKey])

  return { query$, otelContext }
}
