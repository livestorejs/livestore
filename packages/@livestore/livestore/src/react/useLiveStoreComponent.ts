import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import type { LiteralUnion, PrettifyFlat } from '@livestore/utils'
import { omit, shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import { SqliteDsl } from 'effect-db-schema'
import { isEqual, mapValues } from 'lodash-es'
import type { DependencyList } from 'react'
import React from 'react'
import { v4 as uuid } from 'uuid'

import type { ComponentKey } from '../componentKey.js'
import { labelForKey, tableNameForComponentKey } from '../componentKey.js'
import type { GetAtom } from '../reactive.js'
import type { LiveStoreGraphQLQuery } from '../reactiveQueries/graphql.js'
import type { LiveStoreJSQuery } from '../reactiveQueries/js.js'
import type { LiveStoreSQLQuery } from '../reactiveQueries/sql.js'
import type { BaseGraphQLContext, LiveStoreQuery, QueryResult, Store } from '../store.js'
import type { Bindable } from '../util.js'
import { sql } from '../util.js'
import { useStore } from './LiveStoreContext.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

export interface QueryDefinitions {
  [queryName: string]: LiveStoreQuery
}

export type QueryResults<TQuery> = { [queryName in keyof TQuery]: PrettifyFlat<QueryResult<TQuery[queryName]>> }

export type ReactiveSQL = <TResult>(
  genQuery: (get: GetAtom) => string,
  queriedTables: string[],
  bindValues?: Bindable | undefined,
) => LiveStoreSQLQuery<TResult>
export type ReactiveGraphQL = <
  TResult extends Record<string, any>,
  TVariables extends Record<string, any>,
  TContext extends BaseGraphQLContext,
>(
  query: DocumentNode<TResult, TVariables>,
  genVariableValues: (get: GetAtom) => TVariables,
  label?: string,
) => LiveStoreGraphQLQuery<TResult, TVariables, TContext>

type RegisterSubscription = <TQuery extends LiveStoreQuery>(
  query: TQuery,
  onNewValue: (value: QueryResult<TQuery>) => void,
  onUnsubscribe?: () => void,
) => void

type GenQueries<TQueries, TStateResult> = (args: {
  rxSQL: ReactiveSQL
  rxGraphQL: ReactiveGraphQL
  globalQueries: QueryDefinitions
  state$: LiveStoreJSQuery<TStateResult>
  /**
   * Registers a subscription.
   *
   * Passed down for some manual subscribing. Use carefully.
   */
  subscribe: RegisterSubscription
  isTemporaryQuery: boolean
}) => TQueries

export type UseLiveStoreComponentProps<TQueries, TColumns extends ComponentColumns> = {
  stateSchema?: SqliteDsl.TableDefinition<string, TColumns>
  queries?: GenQueries<TQueries, SqliteDsl.FromColumns.RowDecoded<TColumns>>
  reactDeps?: React.DependencyList
  componentKey: ComponentKeyConfig
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
export const useLiveStoreComponent = <TColumns extends ComponentColumns, TQueries extends QueryDefinitions>({
  stateSchema: stateSchema_,
  queries = () => ({}) as TQueries,
  componentKey: componentKeyConfig,
  reactDeps = [],
}: UseLiveStoreComponentProps<TQueries, TColumns>): {
  queryResults: QueryResults<TQueries>
  state: SqliteDsl.FromColumns.RowDecoded<TColumns>
  setState: Setters<SqliteDsl.FromColumns.RowDecoded<TColumns>>
  useLiveStoreJsonState: UseLiveStoreJsonState<SqliteDsl.FromColumns.RowDecoded<TColumns>>
} => {
  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TColumns>

  // TODO validate schema to make sure each column has a default value
  // TODO we should clean up the state schema handling to remove this special handling for the `id` column
  const stateSchema = React.useMemo(
    () => (stateSchema_ ? { ...stateSchema_, columns: omit(stateSchema_.columns, 'id' as any) } : undefined),
    [stateSchema_],
  )

  // performance.mark('useLiveStoreComponent:start')
  const componentKey = useComponentKey(componentKeyConfig, reactDeps)
  const { store, globalQueries } = useStore()

  const componentKeyLabel = React.useMemo(() => labelForKey(componentKey), [componentKey])

  // The following `React.useMemo` and `React.useEffect` calls are used to start and end a span for the lifetime of this component.
  const { span, otelContext } = React.useMemo(() => {
    const existingSpan = spanAlreadyStartedCache.get(componentKeyLabel)
    if (existingSpan !== undefined) return existingSpan

    const span = store.otel.tracer.startSpan(
      `LiveStore:useLiveStoreComponent:${componentKeyLabel}`,
      {},
      store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    spanAlreadyStartedCache.set(componentKeyLabel, { span, otelContext })

    return { span, otelContext }
  }, [componentKeyLabel, store.otel.queriesSpanContext, store.otel.tracer])

  React.useEffect(
    () => () => {
      spanAlreadyStartedCache.delete(componentKeyLabel)
      span.end()
    },
    [componentKeyLabel, span],
  )

  const generateQueries = React.useCallback(
    ({
      state$,
      otelContext,
      registerSubscription,
      isTemporaryQuery,
    }: {
      state$: LiveStoreJSQuery<TComponentState>
      otelContext: otel.Context
      registerSubscription: RegisterSubscription
      isTemporaryQuery: boolean
    }) =>
      queries({
        rxSQL: <T>(genQuery: (get: GetAtom) => string, queriedTables: string[], bindValues?: Bindable) =>
          store.querySQL<T>(genQuery, { queriedTables, bindValues, otelContext, componentKey }),
        rxGraphQL: <Result extends Record<string, any>, Variables extends Record<string, any>>(
          query: DocumentNode<Result, Variables>,
          genVariableValues: (get: GetAtom) => Variables,
          label?: string,
        ) => store.queryGraphQL(query, genVariableValues, { componentKey, label, otelContext }),
        globalQueries,
        state$,
        subscribe: registerSubscription,
        isTemporaryQuery,
      }),

    // NOTE: we don't include the queries function passed in by the user here;
    // the reason is that we don't want to force them to memoize that function.
    // Instead, we just assume that the function always has the same contents.
    // This makes sense for LiveStore because the component config should be static.
    // TODO: document this and consider whether it's the right API surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, componentKey, globalQueries],
  )

  const defaultComponentState = React.useMemo(() => {
    const defaultState = (
      stateSchema === undefined ? {} : mapValues(stateSchema.columns, (c) => c.default)
    ) as TComponentState

    // @ts-expect-error TODO fix typing
    defaultState.id = componentKeyConfig.id

    return defaultState
  }, [componentKeyConfig.id, stateSchema])

  const componentStateEffectSchema = React.useMemo(
    () => (stateSchema ? SqliteDsl.structSchemaForTable(stateSchema) : Schema.any),
    [stateSchema],
  )

  // Step 1:
  // Synchronously create state and queries for initial render pass.
  // We do this in a temporary query context which cleans up after itself, making it idempotent
  // TODO get rid of the temporary query workaround
  const { initialComponentState, initialQueryResults } = React.useMemo(() => {
    return store.otel.tracer.startActiveSpan('LiveStore:useLiveStoreComponent:initial', {}, otelContext, (span) => {
      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      return store.inTempQueryContext(() => {
        try {
          // create state query
          let state$: LiveStoreJSQuery<TComponentState>
          if (stateSchema === undefined) {
            // TODO don't set up a query if there's no state schema (keeps the graph more clean)
            state$ = store.queryJS(() => ({}), {
              componentKey,
              otelContext,
            }) as unknown as LiveStoreJSQuery<TComponentState>
          } else {
            const componentTableName = tableNameForComponentKey(componentKey)
            const whereClause = componentKey._tag === 'singleton' ? '' : `where id = '${componentKey.id}'`
            state$ = store
              .querySQL(() => sql`select * from ${componentTableName} ${whereClause} limit 1`, {
                queriedTables: [componentTableName],
                componentKey,
                label: `localState:query:${componentKeyLabel}`,
                otelContext,
              })
              // TODO consider to instead of just returning the default value, to write the default component state to the DB
              .pipe<TComponentState>((results) =>
                results.length === 1
                  ? Schema.parseSync(componentStateEffectSchema)(results[0]!)
                  : defaultComponentState,
              )
          }
          const initialComponentState = state$.results$.result

          const queries = generateQueries({
            state$: state$,
            otelContext,
            registerSubscription: () => {},
            isTemporaryQuery: true,
          })
          for (const [name, query] of Object.entries(queries)) {
            query.label = name
          }
          const initialQueryResults = mapValues(
            queries,
            (query) => query.results$.result,
            // TODO improve typing
          ) as unknown as QueryResults<TQueries>

          return { initialComponentState, initialQueryResults }
        } finally {
          span.end()
        }
      })
    })
  }, [
    store,
    otelContext,
    stateSchema,
    generateQueries,
    componentKey,
    componentKeyLabel,
    componentStateEffectSchema,
    defaultComponentState,
  ])

  // Now that we've computed the initial state synchronously,
  // we can set up our useState calls w/ a default value populated...
  const [componentStateRef, setComponentState_] = useStateRefWithReactiveInput<TComponentState>(initialComponentState)

  const [queryResultsRef, setQueryResults_] = useStateRefWithReactiveInput<QueryResults<TQueries>>(initialQueryResults)

  const setState = (
    stateSchema === undefined
      ? {}
      : // TODO: do we have a better type for the values that can go in SQLite?
        mapValues(stateSchema.columns, (column, columnName) => (value: string | number) => {
          // Don't update the state if it's the same as the value already seen in the component
          // @ts-expect-error TODO fix typing
          if (componentStateRef.current[columnName] === value) return

          const encodedValue = Schema.encodeSync(column.type.codec)(value)

          if (['componentKey', 'columnNames'].includes(columnName)) {
            shouldNeverHappen(`Can't use reserved column name ${columnName}`)
          }

          return store.applyEvent('updateComponentState', {
            componentKey,
            columnNames: [columnName],
            [columnName]: encodedValue,
          })
        })
  ) as Setters<TComponentState>

  setState.setMany = (columnValues: Partial<TComponentState>) => {
    // TODO use hashing instead
    // Don't update the state if it's the same as the value already seen in the component
    // @ts-expect-error TODO fix typing
    if (Object.entries(columnValues).every(([columnName, value]) => componentStateRef.current[columnName] === value)) {
      return
    }

    const columnNames = Object.keys(columnValues)

    return store.applyEvent('updateComponentState', { componentKey, columnNames, ...columnValues })
  }

  // OK, now all the synchronous work is done;
  // time to set up our long-running queries in an effect
  React.useEffect(() => {
    return store.otel.tracer.startActiveSpan(
      'LiveStore:useLiveStoreComponent:long-running',
      { attributes: {} },
      otelContext,
      (span) => {
        const otelContext = otel.trace.setSpan(otel.context.active(), span)
        const unsubs: (() => void)[] = []

        // create state query
        let state$: LiveStoreJSQuery<TComponentState>
        if (stateSchema === undefined) {
          // TODO remove this query
          state$ = store.queryJS(() => ({}) as TComponentState, {
            componentKey,
            otelContext,
            label: 'empty-component-state',
          })
        } else {
          const componentTableName = tableNameForComponentKey(componentKey)
          insertRowForComponentInstance({ store, componentKey, stateSchema })

          const whereClause = componentKey._tag === 'singleton' ? '' : `where id = '${componentKey.id}'`
          state$ = store
            .querySQL<TComponentState>(() => sql`select * from ${componentTableName} ${whereClause} limit 1`, {
              queriedTables: [componentTableName],
              componentKey,
              label: `localState:query:${componentKeyLabel}`,
              otelContext,
            })
            // TODO consider to instead of just returning the default value, to write the default component state to the DB
            .pipe<TComponentState>((results) =>
              results.length === 1 ? Schema.parseSync(componentStateEffectSchema)(results[0]!) : defaultComponentState,
            )
        }

        unsubs.push(
          store.subscribe(
            state$,
            (results) => {
              if (isEqual(results, componentStateRef.current) === false) {
                setComponentState_(results as TComponentState)
              }
            },
            undefined,
            { label: `useLiveStoreComponent:localState:subscribe:${state$.label}` },
          ),
        )

        const registerSubscription: RegisterSubscription = (query, callback, onUnsubscribe) => {
          unsubs.push(
            store.subscribe(
              query,
              (results) => {
                callback(results)
              },
              onUnsubscribe,
              { label: `useLiveStoreComponent:query:manual-subscribe:${query.label}` },
            ),
          )
        }

        const queries = generateQueries({ state$, otelContext, registerSubscription, isTemporaryQuery: false })

        for (const [key, query] of Object.entries(queries)) {
          // Use the field name given to this query in the useQueries hook as its label
          query.label = key

          unsubs.push(
            store.subscribe(
              query,
              (results) => {
                const newQueryResults = { ...queryResultsRef.current, [key]: results }
                if (isEqual(newQueryResults, queryResultsRef.current) === false) {
                  setQueryResults_(newQueryResults)
                }
              },
              undefined,
              { label: `useLiveStoreComponent:query:subscribe:${query.label}` },
            ),
          )
        }

        return () => {
          for (const unsub of unsubs) {
            unsub()
          }

          span.end()
        }
      },
    )
    // NOTE excluding `setComponentState_` and `setQueryResults_` from the deps array as it seems to cause an infinite loop
    // This should probably be improved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    store,
    componentKey,
    stateSchema,
    defaultComponentState,
    generateQueries,
    otelContext,
    componentStateRef,
    // setComponentState_,
    // setQueryResults_,
  ])

  // Very important: remove any queries / other resources associated w/ this component
  React.useEffect(() => () => store.unmountComponent(componentKey), [store, componentKey])

  // performance.mark('useLiveStoreComponent:end')
  // performance.measure(`useLiveStoreComponent:${componentKey.type}`, 'useLiveStoreComponent:start', 'useLiveStoreComponent:end')

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
    queryResults: queryResultsRef.current,
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

/**
 * Create a row storing the state for a component instance, if none exists yet.
 * Initialized with default values, and keyed on the component key.
 */
const insertRowForComponentInstance = ({
  store,
  componentKey,
  stateSchema,
}: {
  store: Store<BaseGraphQLContext>
  componentKey: ComponentKey
  stateSchema: SqliteDsl.TableDefinition<string, SqliteDsl.Columns>
}) => {
  const columnNames = ['id', ...Object.keys(stateSchema.columns)]
  const columnValues = columnNames.map((name) => `$${name}`).join(', ')

  const tableName = tableNameForComponentKey(componentKey)
  const insertQuery = sql`insert into ${tableName} (${columnNames.join(
    ', ',
  )}) select ${columnValues} where not exists(select 1 from ${tableName} where id = '${componentKey.id}')`

  void store.execute(
    insertQuery,
    {
      ...mapValues(stateSchema.columns, (column) => prepareValueForSql(column.default ?? null)),
      id: componentKey.id,
    },
    [tableName],
  )
}

const prepareValueForSql = (value: string | number | boolean | null) => {
  if (typeof value === 'string' || typeof value === 'number' || value === null) {
    return value
  } else {
    return value ? 1 : 0
  }
}
