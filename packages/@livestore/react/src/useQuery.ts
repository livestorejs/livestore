import { isQueryBuilder } from '@livestore/common'
import type { LiveQuery, LiveQueryDef, Store } from '@livestore/livestore'
import {
  extractStackInfoFromStackTrace,
  isQueryable,
  type Queryable,
  queryDb,
  type SignalDef,
  StoreInternalsSymbol,
  stackInfoToString,
} from '@livestore/livestore'
import type { LiveQueries } from '@livestore/livestore/internal'
import { deepEqual, indent, shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import React from 'react'

import { LiveStoreContext } from './LiveStoreContext.ts'
import { useRcResource } from './useRcResource.ts'
import { originalStackLimit } from './utils/stack-info.ts'
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
 * - `options.store`: Optional store to use; by default the store from `LiveStoreContext` is used.
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
  const store =
    options?.store ?? // biome-ignore lint/correctness/useHookAtTopLevel: store is stable
    React.useContext(LiveStoreContext)?.store ??
    shouldNeverHappen(`No store provided to useQuery`)

  type TResult = Queryable.Result<TQueryable>
  type NormalizedQueryable =
    | { _tag: 'definition'; def: LiveQueryDef<TResult> | SignalDef<TResult> }
    | { _tag: 'live-query'; query$: LiveQuery<TResult> }

  const normalized = React.useMemo<NormalizedQueryable>(() => {
    if (!isQueryable(queryable)) {
      return shouldNeverHappen('useQuery expected a Queryable value')
    }

    if (isQueryBuilder(queryable)) {
      return { _tag: 'definition', def: queryDb(queryable) }
    }

    if (
      (queryable as LiveQueryDef<TResult> | SignalDef<TResult>)._tag === 'def' ||
      (queryable as LiveQueryDef<TResult> | SignalDef<TResult>)._tag === 'signal-def'
    ) {
      return { _tag: 'definition', def: queryable as LiveQueryDef<TResult> | SignalDef<TResult> }
    }

    return { _tag: 'live-query', query$: queryable as LiveQuery<TResult> }
  }, [queryable])

  // It's important to use all "aspects" of a store instance here, otherwise we get unexpected cache mappings
  const rcRefKey = React.useMemo(() => {
    const base = `${store.storeId}_${store.clientId}_${store.sessionId}`

    if (normalized._tag === 'definition') {
      return `${base}:def:${normalized.def.hash}`
    }

    return `${base}:instance:${normalized.query$.id}`
  }, [normalized, store.clientId, store.sessionId, store.storeId])

  const resourceLabel = normalized._tag === 'definition' ? normalized.def.label : normalized.query$.label

  const stackInfo = React.useMemo(() => {
    Error.stackTraceLimit = 10
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return extractStackInfoFromStackTrace(stack)
  }, [])

  const { queryRcRef, span, otelContext } = useRcResource(
    rcRefKey,
    () => {
      const span = store[StoreInternalsSymbol].otel.tracer.startSpan(
        options?.otelSpanName ?? `LiveStore:useQuery:${resourceLabel}`,
        { attributes: { label: resourceLabel, firstStackInfo: JSON.stringify(stackInfo) } },
        options?.otelContext ?? store[StoreInternalsSymbol].otel.queriesSpanContext,
      )

      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      const queryRcRef =
        normalized._tag === 'definition'
          ? normalized.def.make(store[StoreInternalsSymbol].reactivityGraph.context!, otelContext)
          : ({
              value: normalized.query$,
              deref: () => {},
              rc: Number.POSITIVE_INFINITY,
            } satisfies LiveQueries.RcRef<LiveQuery<TResult>>)

      return { queryRcRef, span, otelContext }
    },
    // We need to keep the queryRcRef alive a bit longer, so we have a second `useRcResource` below
    // which takes care of disposing the queryRcRef
    () => {},
  )

  // if (queryRcRef.value._tag === 'signal') {
  //   const  queryRcRef.value.get()
  // }

  const query$ = queryRcRef.value as LiveQuery<TResult>

  React.useDebugValue(`LiveStore:useQuery:${query$.id}:${query$.label}`)
  // console.debug(`LiveStore:useQuery:${query$.id}:${query$.label}`)

  const initialResult = React.useMemo(() => {
    try {
      return query$.run({
        otelContext,
        debugRefreshReason: {
          _tag: 'react',
          api: 'useQuery',
          label: `useQuery:initial-run:${query$.label}`,
          stackInfo,
        },
      })
    } catch (cause: any) {
      console.error('[@livestore/react:useQuery] Error running query', cause)
      throw new Error(
        `\
[@livestore/react:useQuery] Error running query: ${cause.name}

Query: ${query$.label}

React trace:

${indent(stackInfoToString(stackInfo), 4)}

Stack trace:
`,
        { cause },
      )
    }
  }, [otelContext, query$, stackInfo])

  // We know the query has a result by the time we use it; so we can synchronously populate a default state
  const [valueRef, setValue] = useStateRefWithReactiveInput<TResult>(initialResult)

  // TODO we probably need to change the order of `useEffect` calls, so we destroy the query at the end
  // before calling the LS `onEffect` on it

  // Subscribe to future updates for this query
  React.useEffect(() => {
    // TODO double check whether we still need `activeSubscriptions`
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
        if (deepEqual(newValue, valueRef.current) === false) {
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
      // console.debug('deref', queryRcRef.value.id, queryRcRef.value.label)
      queryRcRef.deref()
      span.end()
    },
  )

  return { valueRef, queryRcRef }
}
