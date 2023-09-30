import { useLiveStoreComponent } from '@livestore/livestore/react'
import {
  ComponentKeyConfig,
  QueryDefinitions,
  QueryResults,
  Setters,
} from '@livestore/livestore/dist/react/useLiveStoreComponent'
import { ComponentStateSchema } from '@livestore/livestore/dist/schema'
import { QueryBuilder } from 'drizzle-orm/sqlite-core'
import { SQLiteSelectQueryBuilder } from './index.js'
import { GetAtom, LiveStoreSQLQuery } from '@livestore/livestore'

export * as drizzle from 'drizzle-orm'

type GenQueries<TQueries> = (args: { rxSQL: ReactiveDrizzleSQL; qb: QueryBuilder }) => TQueries

export type UseDrizzleLiveStoreComponentProps<TQueries, TComponentState> = {
  stateSchema?: ComponentStateSchema<TComponentState>
  queries?: GenQueries<TQueries>
  reactDeps?: React.DependencyList
  componentKey: ComponentKeyConfig
}

export const queryBuilder = new QueryBuilder()

type ComponentState = {
  /** Equivalent to `componentKey.key` */
  id: string
  [key: string]: string | number | boolean | null
}

type UseLiveStoreJsonState<TState> = <TResult>(
  jsonStringKey: keyof TState,
  parse?: (_: unknown) => TResult,
) => [value: TResult, setValue: (newVal: TResult | ((prevVal: TResult) => TResult)) => void]

export type ReactiveDrizzleSQL = <TResult>(
  genQuery: (get: GetAtom) => SQLiteSelectQueryBuilder<any, any, any, any, any, any>,
  queriedTables: string[],
) => LiveStoreSQLQuery<TResult>

export const useDrizzle = <TComponentState extends ComponentState, TQueries extends QueryDefinitions>({
  stateSchema,
  queries = () => ({}) as TQueries,
  componentKey,
  reactDeps = [],
}: UseDrizzleLiveStoreComponentProps<TQueries, TComponentState>): {
  queryResults: QueryResults<TQueries>
  state: TComponentState
  setState: Setters<TComponentState>
  useLiveStoreJsonState: UseLiveStoreJsonState<TComponentState>
} => {
  return useLiveStoreComponent<TComponentState, TQueries>({
    // Define the reactive queries for this component
    queries: ({ rxSQL }) => {
      return queries({
        rxSQL: (genQuery, queriedTables) => {
          return rxSQL((get) => {
            return genQuery(get).toSQL().sql
          }, queriedTables)
        },
        qb: queryBuilder,
      })
    },
    componentKey,
    reactDeps,
    stateSchema,
  })
}
