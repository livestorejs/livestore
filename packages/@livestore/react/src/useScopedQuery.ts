import type { QueryInfo } from '@livestore/common'
import type { LiveQuery } from '@livestore/livestore'
import * as otel from '@opentelemetry/api'
import React from 'react'

import { useStore } from './LiveStoreContext.js'
import { useQueryRef } from './useQuery.js'

// NOTE Given `useMemo` will be called multiple times (e.g. when using React Strict mode or Fast Refresh),
// we are using this cache to avoid starting multiple queries/spans for the same component.
// This is somewhat against some recommended React best practices, but it should be fine in our case below.
// Please definitely open an issue if you see or run into any problems with this approach!
const cache = new Map<
  string,
  | {
      _tag: 'active'
      rc: number
      query$: LiveQuery<any, any>
      span: otel.Span
      otelContext: otel.Context
    }
  | {
      _tag: 'destroyed'
    }
>()

export type DepKey = string | number | ReadonlyArray<string | number>

/**
 * Creates a query, subscribes and destroys it when the component unmounts.
 *
 * The `key` is used to determine whether the a new query should be created or if the existing one should be reused.
 * This hook should be used instead of `useQuery` when the query should be dynamically created based on some props.
 * Otherwise when using `useQuery` the query will be leaked (i.e. never destroyed) when the component re-renders/unmounts.
 *
 * Example:
 * ```tsx
 * const issue = useScopedQuery(() => queryDb(tables.issues.query.where('id', issueId).first()), ['issue-details', issueId])
 * ```
 *
 * Important: On Expo/React Native please make sure the key contains a globally unique identifier, otherwise the query might get reused unintentionally.
 * Example: `['issue-details', issueId]`
 * See this issue to track progress: https://github.com/livestorejs/livestore/issues/231
 */
export const useScopedQuery = <TResult>(makeQuery: () => LiveQuery<TResult>, key: DepKey): TResult =>
  useScopedQueryRef(makeQuery, key).current

export const useScopedQueryRef = <TResult>(
  makeQuery: () => LiveQuery<TResult>,
  key: DepKey,
): React.MutableRefObject<TResult> => {
  const { query$ } = useMakeScopedQuery(makeQuery, key)

  return useQueryRef(query$)
}

export const useMakeScopedQuery = <TResult, TQueryInfo extends QueryInfo>(
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
    () => (Array.isArray(key) ? key.join('-') : key) + '-' + store.reactivityGraph.id + '-' + makeQuery.toString(),
    [key, makeQuery, store.reactivityGraph.id],
  )
  const fullKeyRef = React.useRef<string>()

  const { query$, otelContext } = React.useMemo(() => {
    if (fullKeyRef.current !== undefined && fullKeyRef.current !== fullKey) {
      // console.debug('fullKey changed', 'prev', fullKeyRef.current.split('-')[0]!, '-> new', fullKey.split('-')[0]!)

      const cachedItem = cache.get(fullKeyRef.current)
      if (cachedItem !== undefined && cachedItem._tag === 'active') {
        cachedItem.rc--

        if (cachedItem.rc === 0) {
          // console.debug('rc=0-changed', cachedItem.query$.id, cachedItem.query$.label)
          cachedItem.query$.destroy()
          cachedItem.span.end()
          cache.set(fullKeyRef.current, { _tag: 'destroyed' })
        }
      }
    }

    const cachedItem = cache.get(fullKey)
    if (cachedItem !== undefined && cachedItem._tag === 'active') {
      // console.debug('rc++', cachedItem.query$.id, cachedItem.query$.label)
      cachedItem.rc++

      return cachedItem
    }

    const spanName = options?.otel?.spanName ?? `LiveStore:useScopedQuery:${key}`

    const span = store.otel.tracer.startSpan(
      spanName,
      { attributes: options?.otel?.attributes },
      store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const query$ = makeQuery(otelContext)

    cache.set(fullKey, { _tag: 'active', rc: 1, query$, span, otelContext })

    return { query$, otelContext }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  fullKeyRef.current = fullKey

  React.useEffect(() => {
    return () => {
      const fullKey = fullKeyRef.current!
      const cachedItem = cache.get(fullKey)
      // NOTE in case the fullKey changed then the query was already destroyed in the useMemo above
      if (cachedItem === undefined || cachedItem._tag === 'destroyed') return

      // console.debug('rc--', cachedItem.query$.id, cachedItem.query$.label)

      cachedItem.rc--

      if (cachedItem.rc === 0) {
        // console.debug('rc=0', cachedItem.query$.id, cachedItem.query$.label)
        cachedItem.query$.destroy()
        cachedItem.span.end()
        cache.delete(fullKey)
      }
    }
  }, [])

  return { query$, otelContext }
}
