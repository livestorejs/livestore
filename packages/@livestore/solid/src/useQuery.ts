import type { LiveQuery, LiveQueryDef, Queryable, SignalDef, StackInfo, Store } from '@livestore/livestore'
import { extractStackInfoFromStackTrace, isQueryable, queryDb, stackInfoToString } from '@livestore/livestore'
import type { LiveQueries } from '@livestore/livestore/internal'
import { deepEqual, indent, shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import { type Accessor, createMemo, createSignal, on, onCleanup, useContext } from 'solid-js'

import { LiveStoreContext } from './LiveStoreContext.ts'
import { originalStackLimit } from './utils/stack-info.ts'
import { type AccessorMaybe, resolve } from './utils.ts'
import { isQueryBuilder } from '@livestore/common'

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
  queryDef: AccessorMaybe<TQueryable>,
  options?: { store?: Store },
): Accessor<Queryable.Result<TQueryable>> => useQueryRef(queryDef, options).valueRef

/**
 */
export const useQueryRef = <TQueryable extends Queryable<any>>(
  queryable: AccessorMaybe<TQueryable>,
  options?: {
    store?: Store
    /** Parent otel context for the query */
    otelContext?: otel.Context
    /** The name of the span to use for the query */
    otelSpanName?: string
  },
): {
  valueRef: Accessor<Queryable.Result<TQueryable>>
  queryRcRef: Accessor<LiveQueries.RcRef<LiveQuery<Queryable.Result<TQueryable>>>>
} => {
  // SOLID  - does this imply we assume storeArg?.store will never change from being defined to being undefined and vice versa?
  //          because this breaks both react's hook rules and solid's assumptions around context
  const store =
    options?.store ?? // biome-ignore lint/correctness/useHookAtTopLevel: store is stable
    useContext(LiveStoreContext)?.store ??
    shouldNeverHappen(`No store provided to useQuery`)

  type TResult = Queryable.Result<TQueryable>
  type NormalizedQueryable =
    | { _tag: 'definition'; def: LiveQueryDef<TResult> | SignalDef<TResult> }
    | { _tag: 'live-query'; query$: LiveQuery<TResult> }

  const normalized = createMemo<NormalizedQueryable>(() => {
    const _queryable = resolve(queryable)

    if (!isQueryable(_queryable)) {
      return shouldNeverHappen('useQuery expected a Queryable value')
    }

    if (isQueryBuilder(_queryable)) {
      return { _tag: 'definition', def: queryDb(_queryable) }
    }

    if (
      (_queryable as LiveQueryDef<TResult> | SignalDef<TResult>)._tag === 'def' ||
      (_queryable as LiveQueryDef<TResult> | SignalDef<TResult>)._tag === 'signal-def'
    ) {
      return { _tag: 'definition', def: _queryable as LiveQueryDef<TResult> | SignalDef<TResult> }
    }

    return { _tag: 'live-query', query$: _queryable as LiveQuery<TResult> }
  })

  // It's important to use all "aspects" of a store instance here, otherwise we get unexpected cache mappings
  const rcRefKey = createMemo(() => {
    const _normalized = normalized()

    const base = `${store.storeId}_${store.clientId}_${store.sessionId}`

    if (_normalized._tag === 'definition') {
      return `${base}:def:${_normalized.def.hash}`
    }

    return `${base}:instance:${_normalized.query$.id}`
  })

  const resourceLabel = () => {
    const _normalized = normalized()
    return _normalized._tag === 'definition' ? _normalized.def.label : _normalized.query$.label
  }

  const stackInfo = (() => {
    Error.stackTraceLimit = 10
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return extractStackInfoFromStackTrace(stack)
  })()

  const resource = createMemo(
    on(rcRefKey, () => {
      const _normalized = normalized()

      const span = store.otel.tracer.startSpan(
        options?.otelSpanName ?? `LiveStore:useQuery:${resourceLabel()}`,
        { attributes: { label: resourceLabel(), firstStackInfo: JSON.stringify(stackInfo) } },
        options?.otelContext ?? store.otel.queriesSpanContext,
      )

      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      const queryRcRef =
        _normalized._tag === 'definition'
          ? _normalized.def.make(store.reactivityGraph.context!, otelContext)
          : ({
              value: _normalized.query$,
              deref: () => {},
              rc: Number.POSITIVE_INFINITY,
            } satisfies LiveQueries.RcRef<LiveQuery<TResult>>)

      const [valueRef, setValueRef] = createSignal<Queryable.Result<TQueryable>>(
        getInitialResult(queryRcRef.value, otelContext, stackInfo),
      )

      // TODO double check whether we still need `activeSubscriptions`
      queryRcRef.value.activeSubscriptions.add(stackInfo)

      // Dynamic queries only set their actual label after they've been run the first time,
      // so we're also updating the span name here.
      span.updateName(options?.otelSpanName ?? `LiveStore:useQuery:${queryRcRef.value.label}`)

      const cleanup = store.subscribe(
        queryRcRef.value,
        (newValue) => {
          // SOLID  - I wonder if this has implications if we would do setStore({reconcile})
          //          because then the proxy is mutated, which might be backed by the original LiveStore-object
          // NOTE: we return a reference to the result object within LiveStore;
          // this implies that app code must not mutate the results, or else
          // there may be weird reactivity bugs.
          if (deepEqual(newValue, valueRef()) === false) {
            setValueRef(newValue)
          }
        },
        {
          onUnsubsubscribe: () => {
            queryRcRef.value.activeSubscriptions.delete(stackInfo)
          },
          label: queryRcRef.value.label,
          otelContext,
        },
      )

      onCleanup(() => {
        queryRcRef.deref()
        span.end()
        cleanup()
      })

      return { valueRef, queryRcRef }
    }),
  )

  return {
    valueRef() {
      return resource().valueRef()
    },
    queryRcRef() {
      return resource().queryRcRef
    },
  }
}

function getInitialResult<TQueryable extends Queryable<any>>(
  query$: LiveQuery<Queryable.Result<TQueryable>>,
  otelContext: otel.Context,
  stackInfo: StackInfo,
) {
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
}
