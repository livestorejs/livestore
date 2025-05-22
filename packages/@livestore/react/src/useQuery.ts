/* eslint-disable react-hooks/rules-of-hooks */
import type { LiveQuery, LiveQueryDef, Store } from '@livestore/livestore'
import { extractStackInfoFromStackTrace, stackInfoToString } from '@livestore/livestore'
import type { LiveQueries } from '@livestore/livestore/internal'
import { deepEqual, indent, shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import React from 'react'

import { LiveStoreContext } from './LiveStoreContext.js'
import { useRcResource } from './useRcResource.js'
import { originalStackLimit } from './utils/stack-info.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

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
export const useQuery = <TQuery extends LiveQueryDef.Any>(
  queryDef: TQuery,
  options?: { store?: Store },
): LiveQueries.GetResult<TQuery> => useQueryRef(queryDef, options).valueRef.current

/**
 */
export const useQueryRef = <TQuery extends LiveQueryDef.Any>(
  queryDef: TQuery,
  options?: {
    store?: Store
    /** Parent otel context for the query */
    otelContext?: otel.Context
    /** The name of the span to use for the query */
    otelSpanName?: string
  },
): {
  valueRef: React.RefObject<LiveQueries.GetResult<TQuery>>
  queryRcRef: LiveQueries.RcRef<LiveQuery<LiveQueries.GetResult<TQuery>>>
} => {
  const store =
    options?.store ?? React.useContext(LiveStoreContext)?.store ?? shouldNeverHappen(`No store provided to useQuery`)

  // It's important to use all "aspects" of a store instance here, otherwise we get unexpected cache mappings
  const rcRefKey = `${store.storeId}_${store.clientId}_${store.sessionId}_${queryDef.hash}`

  const stackInfo = React.useMemo(() => {
    Error.stackTraceLimit = 10
    // eslint-disable-next-line unicorn/error-message
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return extractStackInfoFromStackTrace(stack)
  }, [])

  const { queryRcRef, span, otelContext } = useRcResource(
    rcRefKey,
    () => {
      const queryDefLabel = queryDef.label

      const span = store.otel.tracer.startSpan(
        options?.otelSpanName ?? `LiveStore:useQuery:${queryDefLabel}`,
        { attributes: { label: queryDefLabel, firstStackInfo: JSON.stringify(stackInfo) } },
        options?.otelContext ?? store.otel.queriesSpanContext,
      )

      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      const queryRcRef = queryDef.make(store.reactivityGraph.context!, otelContext)

      return { queryRcRef, span, otelContext }
    },
    // We need to keep the queryRcRef alive a bit longer, so we have a second `useRcResource` below
    // which takes care of disposing the queryRcRef
    () => {},
  )

  // if (queryRcRef.value._tag === 'signal') {
  //   const  queryRcRef.value.get()
  // }

  const query$ = queryRcRef.value as LiveQuery<LiveQueries.GetResult<TQuery>>

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
  const [valueRef, setValue] = useStateRefWithReactiveInput<LiveQueries.GetResult<TQuery>>(initialResult)

  // TODO we probably need to change the order of `useEffect` calls, so we destroy the query at the end
  // before calling the LS `onEffect` on it

  // Subscribe to future updates for this query
  React.useEffect(() => {
    // TODO double check whether we still need `activeSubscriptions`
    query$.activeSubscriptions.add(stackInfo)

    // Dynamic queries only set their actual label after they've been run the first time,
    // so we're also updating the span name here.
    span.updateName(options?.otelSpanName ?? `LiveStore:useQuery:${query$.label}`)

    return store.subscribe(query$, {
      onUpdate: (newValue) => {
        // NOTE: we return a reference to the result object within LiveStore;
        // this implies that app code must not mutate the results, or else
        // there may be weird reactivity bugs.
        if (deepEqual(newValue, valueRef.current) === false) {
          setValue(newValue)
        }
      },
      onUnsubsubscribe: () => {
        query$.activeSubscriptions.delete(stackInfo)
      },
      label: query$.label,
      otelContext,
    })
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
