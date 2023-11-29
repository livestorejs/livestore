import type { LiteralUnion } from '@livestore/utils'
import { omit } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { SqliteDsl } from 'effect-db-schema'
import { isEqual, mapValues } from 'lodash-es'
import type { DependencyList } from 'react'
import React from 'react'
import { v4 as uuid } from 'uuid'

import type { ComponentKey } from '../componentKey.js'
import { labelForKey } from '../componentKey.js'
import type { LiveStoreJSQuery } from '../reactiveQueries/js.js'
import { insertRowForComponentInstance, stateQuery } from '../state.js'
import type { LiveStoreQuery } from '../store.js'
import { useStore } from './LiveStoreContext.js'
import { extractStackInfoFromStackTrace, originalStackLimit } from './utils/stack-info.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

export interface QueryDefinitions {
  [queryName: string]: LiveStoreQuery
}

export type UseComponentStateProps<TStateColumns extends ComponentColumns> = {
  schema: SqliteDsl.TableDefinition<string, TStateColumns>
  componentKey: ComponentKeyConfig
  reactDeps?: React.DependencyList
}

export type ComponentKeyConfig = {
  /**
   * Name of the Component
   *
   * TODO we should eventually derive this info automatically from the component (TBD how though...)
   */
  name: string
  id: LiteralUnion<'singleton' | '__ephemeral__', string>
}

// TODO enforce columns are non-nullable or have a default
export interface ComponentColumns extends SqliteDsl.Columns {
  id: SqliteDsl.ColumnDefinition<SqliteDsl.FieldType.FieldTypeText<string, string>, false>
}

// type ComponentState = {
//   /** Equivalent to `componentKey.key` */
//   id: string
//   [key: string]: string | number | boolean | null
// }

/**
 * This is needed because the `React.useMemo` call below, can sometimes be called multiple times 🤷,
 * so we need to "cache" the fact that we've already started a span for this component.
 * The map entry is being removed again in the `React.useEffect` call below.
 */
const spanAlreadyStartedCache = new Map<string, { span: otel.Span; otelContext: otel.Context }>()

type UseLiveStoreJsonState<TState> = <TResult>(
  jsonStringKey: keyof TState,
  parse?: (_: unknown) => TResult,
) => [value: TResult, setValue: (newVal: TResult | ((prevVal: TResult) => TResult)) => void]

export type GetStateType<TTableDef extends SqliteDsl.TableDefinition<any, any>> = SqliteDsl.FromColumns.RowDecoded<
  TTableDef['columns']
>

export type GetStateTypeEncoded<TTableDef extends SqliteDsl.TableDefinition<any, any>> =
  SqliteDsl.FromColumns.RowEncoded<TTableDef['columns']>

/**
 * Create reactive queries within a component.
 * @param config.queries A function that returns a map of named reactive queries.
 * @param config.componentKey A function that returns a unique key for this component.
 * @param config.reactDeps A list of React-level dependencies that will refresh the queries.
 */
export const useComponentState = <TStateColumns extends ComponentColumns>({
  schema: stateSchema_,
  componentKey: componentKeyConfig,
  reactDeps = [],
}: UseComponentStateProps<TStateColumns>): {
  state$: LiveStoreJSQuery<SqliteDsl.FromColumns.RowDecoded<TStateColumns>>
  state: SqliteDsl.FromColumns.RowDecoded<TStateColumns>
  setState: Setters<SqliteDsl.FromColumns.RowDecoded<TStateColumns>>
  useLiveStoreJsonState: UseLiveStoreJsonState<SqliteDsl.FromColumns.RowDecoded<TStateColumns>>
} => {
  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TStateColumns>

  // TODO validate schema to make sure each column has a default value
  // TODO we should clean up the state schema handling to remove this special handling for the `id` column
  const stateSchema = React.useMemo(
    () => ({ ...stateSchema_, columns: omit(stateSchema_.columns, 'id' as any) }),
    [stateSchema_],
  )

  const componentKey = useComponentKey(componentKeyConfig, reactDeps)
  const { store } = useStore()

  const componentKeyLabel = React.useMemo(() => labelForKey(componentKey), [componentKey])

  const stackInfo = React.useMemo(() => {
    Error.stackTraceLimit = 10
    // eslint-disable-next-line unicorn/error-message
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return extractStackInfoFromStackTrace(stack)
  }, [])

  // The following `React.useMemo` and `React.useEffect` calls are used to start and end a span for the lifetime of this component.
  const { span, otelContext } = React.useMemo(() => {
    const existingSpan = spanAlreadyStartedCache.get(componentKeyLabel)
    if (existingSpan !== undefined) return existingSpan

    const span = store.otel.tracer.startSpan(
      `LiveStore:useComponentState:${componentKeyLabel}`,
      { attributes: { stackInfo: JSON.stringify(stackInfo) } },
      store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    spanAlreadyStartedCache.set(componentKeyLabel, { span, otelContext })

    return { span, otelContext }
  }, [componentKeyLabel, stackInfo, store.otel.queriesSpanContext, store.otel.tracer])

  React.useEffect(
    () => () => {
      spanAlreadyStartedCache.delete(componentKeyLabel)
      span.end()
    },
    [componentKeyLabel, span],
  )

  // create state query
  const state$ = React.useMemo(
    () =>
      stateQuery({
        def: {
          schema: stateSchema_,
          isSingleColumn: false,
          type: componentKey._tag === 'singleton' ? 'singleton' : 'variable',
        },
        store,
        id: componentKey._tag === 'singleton' ? undefined : componentKey.id,
        otelContext,
      }),
    [componentKey._tag, componentKey.id, otelContext, stateSchema_, store],
  )

  // Step 1:
  // Synchronously create state and queries for initial render pass.
  const initialComponentState = React.useMemo(
    () => state$.run(otelContext, { _tag: 'react', api: 'useComponentState', label: state$.label, stackInfo }),
    [otelContext, stackInfo, state$],
  )

  // Now that we've computed the initial state synchronously,
  // we can set up our useState calls w/ a default value populated...
  const [componentStateRef, setComponentState_] = useStateRefWithReactiveInput<TComponentState>(initialComponentState)

  const setState = // TODO: do we have a better type for the values that can go in SQLite?
    mapValues(stateSchema.columns, (column, columnName) => (value: string | number) => {
      // Don't update the state if it's the same as the value already seen in the component
      // @ts-expect-error TODO fix typing
      if (componentStateRef.current[columnName] === value) return

      const encodedValue = Schema.encodeSync(column.type.codec)(value)

      return store.applyEvent('livestore.UpdateComponentState', {
        tableName: stateSchema.name,
        columnNames: [columnName],
        id: componentKey._tag === 'singleton' ? undefined : componentKey.id,
        bindValues: { [columnName]: encodedValue },
      })
    }) as Setters<TComponentState>

  setState.setMany = (columnValues: Partial<TComponentState>) => {
    // TODO use hashing instead
    // Don't update the state if it's the same as the value already seen in the component
    // @ts-expect-error TODO fix typing
    if (Object.entries(columnValues).every(([columnName, value]) => componentStateRef.current[columnName] === value)) {
      return
    }

    const columnNames = Object.keys(columnValues)

    return store.applyEvent('livestore.UpdateComponentState', {
      tableName: stateSchema.name,
      columnNames,
      id: componentKey._tag === 'singleton' ? undefined : componentKey.id,
      bindValues: columnValues,
    })
  }

  // OK, now all the synchronous work is done;
  // time to set up our long-running queries in an effect
  React.useEffect(() => {
    return store.otel.tracer.startActiveSpan(
      'LiveStore:useComponentState:long-running',
      { attributes: {} },
      otelContext,
      (span) => {
        const unsubs: (() => void)[] = []

        const otelContext = otel.trace.setSpan(otel.context.active(), span)
        insertRowForComponentInstance({
          db: store._proxyDb,
          id: componentKey._tag === 'singleton' ? 'singleton' : componentKey.id,
          stateSchema,
          otelContext,
        })

        state$.activeSubscriptions.add(stackInfo)

        unsubs.push(
          store.subscribe(
            state$,
            (results) => {
              if (isEqual(results, componentStateRef.current) === false) {
                setComponentState_(results as TComponentState)
              }
            },
            undefined,
            { label: `useComponentState:localState:subscribe:${state$.label}`, otelContext },
          ),
          () => state$.activeSubscriptions.delete(stackInfo),
        )

        return () => {
          for (const unsub of unsubs) {
            unsub()
          }

          span.end()
        }
      },
    )
  }, [store, stackInfo, stateSchema, otelContext, componentStateRef, state$, setComponentState_, componentKey])

  React.useEffect(() => () => state$.destroy(), [state$])

  const state = componentStateRef.current

  const useLiveStoreJsonState = <TResult>(
    jsonStringKey: keyof TComponentState,
    parse: (_: unknown) => TResult = (_) => _ as TResult,
  ): [value: TResult, setValue: (newVal: TResult | ((prevVal: TResult) => TResult)) => void] => {
    const value = React.useMemo<TResult>(() => {
      return parse(JSON.parse(state[jsonStringKey] as string))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state[jsonStringKey], parse])

    const setValue = React.useCallback(
      (newValOrFn: TResult | ((prev: TResult) => TResult)) => {
        const newVal =
          typeof newValOrFn === 'function'
            ? // NOTE we're using the ref instead of the value because we want to be sure
              // we're using the latest value when the setter is called
              (newValOrFn as any)(parse(JSON.parse(componentStateRef.current[jsonStringKey] as string)))
            : newValOrFn
        setState[jsonStringKey](JSON.stringify(newVal) as any)
      },
      [parse, jsonStringKey],
    )

    return [value, setValue]
  }

  return {
    state$,
    state,
    setState,
    useLiveStoreJsonState,
  }
}

export type Setters<TComponentState> = {
  [k in keyof TComponentState]: (newValue: TComponentState[k]) => void
} & {
  setMany: (newValues: Partial<TComponentState>) => void
}

export const useComponentKey = ({ name, id }: ComponentKeyConfig, deps: DependencyList = []) =>
  React.useMemo<ComponentKey>(() => {
    switch (id) {
      case 'singleton': {
        return { _tag: 'singleton', componentName: name, id: 'singleton' }
      }
      case '__ephemeral__': {
        return { _tag: 'ephemeral', componentName: name, id: uuid() }
      }
      default: {
        return { _tag: 'custom', componentName: name, id }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, id, name])
