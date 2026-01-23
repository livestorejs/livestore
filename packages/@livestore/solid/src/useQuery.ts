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
import { deepEqual } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
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
  options: { store: Store<any, any> },
): Solid.Accessor<Queryable.Result<TQueryable>> => useQueryRef(queryDef, options).valueRef

/**
 */
export const useQueryRef = <TQueryable extends Queryable<any>>(
  queryable: AccessorMaybe<TQueryable>,
  options: {
    store: Store<any, any>
    /** Parent otel context for the query */
    otelContext?: otel.Context
    /** The name of the span to use for the query */
    otelSpanName?: string
  },
): {
  valueRef: Solid.Accessor<Queryable.Result<TQueryable>>
  queryRcRef: Solid.Accessor<LiveQueries.RcRef<LiveQuery<Queryable.Result<TQueryable>>>>
} => {
  type TResult = Queryable.Result<TQueryable>

  const normalized = Solid.createMemo<NormalizedQueryable<TResult>>(() =>
    normalizeQueryable(resolve(queryable) as Queryable<TResult>),
  )

  const rcRefKey = Solid.createMemo(() => computeRcRefKey(options.store, normalized()))

  const stackInfo = captureStackInfo()

  const resource = Solid.createMemo(
    Solid.on(rcRefKey, () => {
      const _normalized = normalized()

      const { queryRcRef, span, otelContext } = createQueryResource(options.store, _normalized, stackInfo, {
        otelSpanName: options.otelSpanName,
        otelContext: options.otelContext,
      })

      const [valueRef, setValueRef] = Solid.createSignal<Queryable.Result<TQueryable>>(
        runInitialQuery(queryRcRef.value, otelContext, stackInfo, 'solid'),
      )

      queryRcRef.value.activeSubscriptions.add(stackInfo)

      // Dynamic queries only set their actual label after they've been run the first time,
      // so we're also updating the span name here.
      span.updateName(options.otelSpanName ?? `LiveStore:useQuery:${queryRcRef.value.label}`)

      const cleanup = options.store.subscribe(
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
