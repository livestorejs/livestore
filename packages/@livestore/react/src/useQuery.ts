import type * as otel from '@opentelemetry/api'
import React from 'react'

import {
  captureStackInfo,
  computeRcRefKey,
  createQueryResource,
  type NormalizedQueryable,
  normalizeQueryable,
  runInitialQuery,
} from '@livestore/framework-toolkit'
import type { LiveQuery, Queryable, Store } from '@livestore/livestore'
import type { LiveQueries } from '@livestore/livestore/internal'
import { deepEqual, shouldNeverHappen } from '@livestore/utils'

import { useRcResource } from './useRcResource.ts'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.ts'

/**
 * Returns the result of a query and subscribes to future updates.
 *
 * Example:
 * ```tsx
 * const App = () => {
 *   const todos = useQuery(queryDb(tables.todos.query.where({ complete: true })))
 *   return <div>{todos.map((todo) => <div key={todo.id}>{todo.title}</div>)}</div>
 * }
 * ```
 */
export const useQuery = <TQueryable extends Queryable<any>>(
  queryable: TQueryable,
  options?: { store?: Store },
): Queryable.Result<TQueryable> => useQueryRef(queryable, options).valueRef.current

/**
 * Like `useQuery`, but also returns a reference to the underlying LiveQuery instance.
 *
 * Usage
 * - Accepts any `Queryable<TResult>`: a `LiveQueryDef`, `SignalDef`, a `LiveQuery` instance
 *   or a SQL `QueryBuilder`. Unions of queryables are supported and the result type is
 *   inferred via `Queryable.Result<TQueryable>`.
 * - Creates an OpenTelemetry span per unique query, reusing it while the ref-counted
 *   resource is alive. The span name is updated once the dynamic label is known.
 * - Manages a reference-counted resource under-the-hood so query instances are shared
 *   across re-renders and properly disposed once no longer referenced.
 *
 * Parameters
 * - `queryable`: The query definition/instance/builder to run and subscribe to.
 * - `options.store`: The store to use. Required when calling `useQueryRef` directly; automatically provided when using `store.useQuery()`.
 * - `options.otelContext`: Optional parent otel context for the query span.
 * - `options.otelSpanName`: Optional explicit span name; otherwise derived from the query label.
 *
 * Returns
 * - `valueRef`: A React ref whose `current` holds the latest query result. The type is
 *   `Queryable.Result<TQueryable>` with full inference for unions.
 * - `queryRcRef`: The underlying reference-counted `LiveQuery` instance used by the store.
 */
export const useQueryRef = <TQueryable extends Queryable<any>>(
  queryable: TQueryable,
  options?: {
    store?: Store
    /** Parent otel context for the query */
    otelContext?: otel.Context
    /** The name of the span to use for the query */
    otelSpanName?: string
  },
): {
  valueRef: React.RefObject<Queryable.Result<TQueryable>>
  queryRcRef: LiveQueries.RcRef<LiveQuery<Queryable.Result<TQueryable>>>
} => {
  const store = options?.store ?? shouldNeverHappen(`No store provided to useQuery`)

  type TResult = Queryable.Result<TQueryable>

  const normalized = React.useMemo<NormalizedQueryable<TResult>>(
    () => normalizeQueryable(queryable as Queryable<TResult>),
    [queryable],
  )

  const rcRefKey = React.useMemo(() => computeRcRefKey(store, normalized), [normalized, store])

  const stackInfo = React.useMemo(() => captureStackInfo(), [])

  const { queryRcRef, span, otelContext } = useRcResource(
    rcRefKey,
    () =>
      createQueryResource(store, normalized, stackInfo, {
        otelSpanName: options?.otelSpanName,
        otelContext: options?.otelContext,
      }),
    // We need to keep the queryRcRef alive a bit longer, so we have a second `useRcResource` below
    // which takes care of disposing the queryRcRef
    () => {},
  )

  const query$ = queryRcRef.value

  React.useDebugValue(`LiveStore:useQuery:${query$.id}:${query$.label}`)

  const initialResult = React.useMemo(
    () => runInitialQuery(query$, otelContext, stackInfo, 'react'),
    [otelContext, query$, stackInfo],
  )

  // We know the query has a result by the time we use it; so we can synchronously populate a default state
  const [valueRef, setValue] = useStateRefWithReactiveInput<TResult>(initialResult)

  // Subscribe to future updates for this query
  React.useEffect(() => {
    query$.activeSubscriptions.add(stackInfo)

    // Dynamic queries only set their actual label after they've been run the first time,
    // so we're also updating the span name here.
    span.updateName(options?.otelSpanName ?? `LiveStore:useQuery:${query$.label}`)

    return store.subscribe(
      query$,
      (newValue) => {
        // NOTE: we return a reference to the result object within LiveStore;
        // this implies that app code must not mutate the results, or else
        // there may be weird reactivity bugs.
        if (!deepEqual(newValue, valueRef.current)) {
          setValue(newValue)
        }
      },
      {
        onUnsubsubscribe: () => {
          query$.activeSubscriptions.delete(stackInfo)
        },
        label: query$.label,
        otelContext,
      },
    )
  }, [stackInfo, query$, setValue, store, valueRef, otelContext, span, options?.otelSpanName])

  useRcResource(
    rcRefKey,
    () => ({ queryRcRef, span }),
    ({ queryRcRef, span }) => {
      queryRcRef.deref()
      span.end()
    },
  )

  return { valueRef, queryRcRef }
}
