import {
  captureStackInfo,
  computeRcRefKey,
  formatQueryError,
  type NormalizedQueryable,
  normalizeQueryable,
  type StackInfo,
} from '@livestore/framework-toolkit'
import type { LiveQuery, Queryable, Store } from '@livestore/livestore'
import { StoreInternalsSymbol } from '@livestore/livestore'
import type { LiveQueries } from '@livestore/livestore/internal'
import { deepEqual, shouldNeverHappen } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import * as Solid from 'solid-js'

import { type AccessorMaybe, resolve } from './utils.ts'

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
): Solid.Accessor<Queryable.Result<TQueryable>> => useQueryRef(queryDef, options).valueRef

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
  valueRef: Solid.Accessor<Queryable.Result<TQueryable>>
  queryRcRef: Solid.Accessor<LiveQueries.RcRef<LiveQuery<Queryable.Result<TQueryable>>>>
} => {
  const store = options?.store ?? shouldNeverHappen(`No store provided to useQuery`)

  type TResult = Queryable.Result<TQueryable>

  const normalized = Solid.createMemo<NormalizedQueryable<TResult>>(() =>
    normalizeQueryable(resolve(queryable) as Queryable<TResult>),
  )

  const rcRefKey = Solid.createMemo(() => computeRcRefKey(store, normalized()))

  const resourceLabel = () => {
    const _normalized = normalized()
    return _normalized._tag === 'definition' ? _normalized.def.label : _normalized.query$.label
  }

  const stackInfo = captureStackInfo()

  const resource = Solid.createMemo(
    Solid.on(rcRefKey, () => {
      const _normalized = normalized()

      const span = store[StoreInternalsSymbol].otel.tracer.startSpan(
        options?.otelSpanName ?? `LiveStore:useQuery:${resourceLabel()}`,
        { attributes: { label: resourceLabel(), firstStackInfo: JSON.stringify(stackInfo) } },
        options?.otelContext ?? store[StoreInternalsSymbol].otel.queriesSpanContext,
      )

      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      const queryRcRef =
        _normalized._tag === 'definition'
          ? _normalized.def.make(store[StoreInternalsSymbol].reactivityGraph.context!, otelContext)
          : ({
              value: _normalized.query$,
              deref: () => {},
              rc: Number.POSITIVE_INFINITY,
            } satisfies LiveQueries.RcRef<LiveQuery<TResult>>)

      const [valueRef, setValueRef] = Solid.createSignal<Queryable.Result<TQueryable>>(
        getInitialResult(queryRcRef.value, otelContext, stackInfo),
      )

      queryRcRef.value.activeSubscriptions.add(stackInfo)

      // Dynamic queries only set their actual label after they've been run the first time,
      // so we're also updating the span name here.
      span.updateName(options?.otelSpanName ?? `LiveStore:useQuery:${queryRcRef.value.label}`)

      const cleanup = store.subscribe(
        queryRcRef.value,
        (newValue) => {
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

      Solid.onCleanup(() => {
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
    console.error('[@livestore/solid:useQuery] Error running query', cause)
    throw formatQueryError(cause, query$.label, stackInfo, 'solid')
  }
}
