import type { LiteralUnion } from '@livestore/utils'
import { omit, shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'
import { isEqual, mapValues } from 'lodash-es'
import type { DependencyList } from 'react'
import React from 'react'
import { v4 as uuid } from 'uuid'

import type { ComponentKey } from '../componentKey.js'
import { labelForKey, tableNameForComponentKey } from '../componentKey.js'
import { migrateTable } from '../migrations.js'
import { LiveStoreJSQuery } from '../reactiveQueries/js.js'
import { LiveStoreSQLQuery } from '../reactiveQueries/sql.js'
import { SCHEMA_META_TABLE } from '../schema.js'
import type { BaseGraphQLContext, LiveStoreQuery, Store } from '../store.js'
import { sql } from '../util.js'
import { useStore } from './LiveStoreContext.js'
import { extractStackInfoFromStackTrace, originalStackLimit } from './utils/extractStackInfoFromStackTrace.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

export interface QueryDefinitions {
  [queryName: string]: LiveStoreQuery
}

export type UseComponentStateProps<TStateColumns extends ComponentColumns> = {
  schema?: SqliteDsl.TableDefinition<string, TStateColumns>
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
    () => (stateSchema_ ? { ...stateSchema_, columns: omit(stateSchema_.columns, 'id' as any) } : undefined),
    [stateSchema_],
  )

  const componentKey = useComponentKey(componentKeyConfig, reactDeps)
  const { store } = useStore()

  const componentKeyLabel = React.useMemo(() => labelForKey(componentKey), [componentKey])

  // The following `React.useMemo` and `React.useEffect` calls are used to start and end a span for the lifetime of this component.
  const { span, otelContext } = React.useMemo(() => {
    const existingSpan = spanAlreadyStartedCache.get(componentKeyLabel)
    if (existingSpan !== undefined) return existingSpan

    const span = store.otel.tracer.startSpan(
      `LiveStore:useComponentState:${componentKeyLabel}`,
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

  const state$ = React.useMemo(() => {
    // create state query
    if (stateSchema === undefined) {
      // TODO don't set up a query if there's no state schema (keeps the graph more clean)
      return new LiveStoreJSQuery({
        fn: () => ({}) as TComponentState,
        label: 'empty-component-state',
        // otelContext,
        // otelTracer: store.otel.tracer,
      })
    } else {
      const componentTableName = tableNameForComponentKey(componentKey)
      const whereClause = componentKey._tag === 'singleton' ? '' : `where id = '${componentKey.id}'`

      // TODO find a better solution for this
      if (store.tableRefs[componentTableName] === undefined) {
        const schemaHash = SqliteAst.hash(stateSchema.ast)
        const res = store.inMemoryDB.select<{ schemaHash: number }>(
          sql`SELECT schemaHash FROM ${SCHEMA_META_TABLE} WHERE tableName = '${componentTableName}'`,
        )
        if (res.length === 0 || res[0]!.schemaHash !== schemaHash) {
          migrateTable({ db: store._proxyDb, tableDef: stateSchema.ast, otelContext, schemaHash })
        }

        store.tableRefs[componentTableName] = store.graph.makeRef(null, {
          equal: () => false,
          label: componentTableName,
          meta: { liveStoreRefType: 'table' },
        })
      }

      return (
        new LiveStoreSQLQuery({
          label: `localState:query:${componentKeyLabel}`,
          genQueryString: () => sql`select * from ${componentTableName} ${whereClause} limit 1`,
          queriedTables: [componentTableName],
        })
          // TODO consider to instead of just returning the default value, to write the default component state to the DB
          .pipe<TComponentState>((results) =>
            results.length === 1 ? Schema.parseSync(componentStateEffectSchema)(results[0]!) : defaultComponentState,
          )
      )
    }
  }, [
    componentKey,
    componentKeyLabel,
    componentStateEffectSchema,
    defaultComponentState,
    otelContext,
    stateSchema,
    store,
  ])

  // Step 1:
  // Synchronously create state and queries for initial render pass.
  const initialComponentState = React.useMemo(() => state$.run(otelContext), [otelContext, state$])

  // Now that we've computed the initial state synchronously,
  // we can set up our useState calls w/ a default value populated...
  const [componentStateRef, setComponentState_] = useStateRefWithReactiveInput<TComponentState>(initialComponentState)

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

  const subscriptionInfo = React.useMemo(() => {
    Error.stackTraceLimit = 10
    // eslint-disable-next-line unicorn/error-message
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return { stack: extractStackInfoFromStackTrace(stack) }
  }, [])

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
        if (stateSchema !== undefined) {
          insertRowForComponentInstance({ store, componentKey, stateSchema, otelContext })
        }

        state$.activeSubscriptions.add(subscriptionInfo)

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
          () => state$.activeSubscriptions.delete(subscriptionInfo),
        )

        return () => {
          for (const unsub of unsubs) {
            unsub()
          }

          span.end()
        }
      },
    )
  }, [
    store,
    subscriptionInfo,
    stateSchema,
    defaultComponentState,
    otelContext,
    componentStateRef,
    state$,
    setComponentState_,
    componentKey,
  ])

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

/**
 * Create a row storing the state for a component instance, if none exists yet.
 * Initialized with default values, and keyed on the component key.
 */
const insertRowForComponentInstance = ({
  store,
  componentKey,
  stateSchema,
  otelContext,
}: {
  store: Store<BaseGraphQLContext>
  componentKey: ComponentKey
  stateSchema: SqliteDsl.TableDefinition<string, SqliteDsl.Columns>
  otelContext: otel.Context
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
    otelContext,
  )
}

const prepareValueForSql = (value: string | number | boolean | null) => {
  if (typeof value === 'string' || typeof value === 'number' || value === null) {
    return value
  } else {
    return value ? 1 : 0
  }
}
