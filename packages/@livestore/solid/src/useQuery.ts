import { deepEqual, indent, shouldNeverHappen } from '@livestore/utils'
import { extractStackInfoFromStackTrace, stackInfoToString } from '@livestore/livestore'
import * as otel from '@opentelemetry/api'
import type { LiveQueries } from '@livestore/livestore/internal'
import type { LiveQuery, LiveQueryDef, Store } from '@livestore/livestore'

import { LiveStoreContext } from './LiveStoreContext.ts'
import { useRcResource } from './useRcResource.ts'
import { originalStackLimit } from './utils/stack-info.ts'
import { createEffect, createMemo, useContext, type Accessor } from 'solid-js'
import { createWritable } from './utils/create-writable.ts'

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
  queryDef: Accessor<TQuery>,
  options?: { store?: Store },
): Accessor<LiveQueries.GetResult<TQuery>> => useQueryRef(queryDef, options).valueRef

/**
 */
export const useQueryRef = <TQuery extends LiveQueryDef.Any>(
  queryDef: Accessor<TQuery>,
  options?: {
    store?: Store
    /** Parent otel context for the query */
    otelContext?: otel.Context
    /** The name of the span to use for the query */
    otelSpanName?: string
  },
): {
  valueRef: Accessor<LiveQueries.GetResult<TQuery>>
  queryRcRef: Accessor<LiveQueries.RcRef<LiveQuery<LiveQueries.GetResult<TQuery>>>>
} => {
  // SOLID  - does this imply we assume storeArg?.store will never change from being defined to being undefined and vice versa?
  //          because this breaks both react's hook rules and solid's assumptions around context
  const store =
    options?.store ?? // biome-ignore lint/correctness/useHookAtTopLevel: store is stable
    useContext(LiveStoreContext)?.store ??
    shouldNeverHappen(`No store provided to useQuery`)

  // It's important to use all "aspects" of a store instance here, otherwise we get unexpected cache mappings
  const rcRefKey = () => `${store.storeId}_${store.clientId}_${store.sessionId}_${queryDef().hash}`

  const stackInfo = (() => {
    Error.stackTraceLimit = 10
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return extractStackInfoFromStackTrace(stack)
  })()

  const resource = useRcResource(
    rcRefKey,
    () => {
      const queryDefLabel = queryDef().label

      const span = store.otel.tracer.startSpan(
        options?.otelSpanName ?? `LiveStore:useQuery:${queryDefLabel}`,
        { attributes: { label: queryDefLabel, firstStackInfo: JSON.stringify(stackInfo) } },
        options?.otelContext ?? store.otel.queriesSpanContext,
      )

      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      const queryRcRef = queryDef().make(store.reactivityGraph.context!, otelContext)

      return { queryRcRef, span, otelContext }
    },
    // We need to keep the queryRcRef alive a bit longer, so we have a second `useRcResource` below
    // which takes care of disposing the queryRcRef
    () => {},
  )

  // if (queryRcRef.value._tag === 'signal') {
  //   const  queryRcRef.value.get()
  // }

  const query$ = () => resource().queryRcRef.value as LiveQuery<LiveQueries.GetResult<TQuery>>

  // React.useDebugValue(`LiveStore:useQuery:${query$.id}:${query$.label}`)
  // console.debug(`LiveStore:useQuery:${query$.id}:${query$.label}`)

  const initialResult = createMemo(() => {
    try {
      return query$().run({
        otelContext: resource().otelContext,
        debugRefreshReason: {
          _tag: 'react',
          api: 'useQuery',
          label: `useQuery:initial-run:${query$().label}`,
          stackInfo,
        },
      })
    } catch (cause: any) {
      console.error('[@livestore/react:useQuery] Error running query', cause)
      throw new Error(
        `\
[@livestore/react:useQuery] Error running query: ${cause.name}

Query: ${query$().label}

React trace:

${indent(stackInfoToString(stackInfo), 4)}

Stack trace:
`,
        { cause },
      )
    }
  })

  // We know the query has a result by the time we use it; so we can synchronously populate a default state
  const [valueRef, setValue] = createWritable<LiveQueries.GetResult<TQuery>>(initialResult)

  // TODO we probably need to change the order of `useEffect` calls, so we destroy the query at the end
  // before calling the LS `onEffect` on it

  // Subscribe to future updates for this query
  createEffect(() => {
    // TODO double check whether we still need `activeSubscriptions`
    query$().activeSubscriptions.add(stackInfo)

    // Dynamic queries only set their actual label after they've been run the first time,
    // so we're also updating the span name here.
    resource().span.updateName(options?.otelSpanName ?? `LiveStore:useQuery:${query$().label}`)

    return store.subscribe(
      query$(),
      (newValue) => {
        // NOTE: we return a reference to the result object within LiveStore;
        // this implies that app code must not mutate the results, or else
        // there may be weird reactivity bugs.
        if (deepEqual(newValue, valueRef()) === false) {
          setValue(newValue)
        }
      },
      {
        onUnsubsubscribe: () => {
          query$().activeSubscriptions.delete(stackInfo)
        },
        label: query$().label,
        otelContext: resource().otelContext,
      },
    )
  })

  useRcResource(
    rcRefKey,
    () => ({ queryRcRef: resource().queryRcRef, span: resource().span }),
    ({ queryRcRef, span }) => {
      // console.debug('deref', queryRcRef.value.id, queryRcRef.value.label)
      queryRcRef.deref()
      span.end()
    },
  )

  return { valueRef, queryRcRef: () => resource().queryRcRef }
}
