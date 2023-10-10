import type { GetAtom, LiveStoreSQLQuery, SqliteDsl } from '@livestore/livestore'
import type {
  ComponentColumns,
  ComponentKeyConfig,
  QueryDefinitions,
  QueryResults,
  Setters,
} from '@livestore/livestore/react'
import { useLiveStoreComponent } from '@livestore/livestore/react'
import { QueryBuilder } from 'drizzle-orm/sqlite-core'

import type { SQLiteSelectQueryBuilder } from './index.js'

export * as drizzle from 'drizzle-orm'

type GenQueries<TQueries> = (args: { rxSQL: ReactiveDrizzleSQL; qb: QueryBuilder }) => TQueries

export type UseDrizzleLiveStoreComponentProps<TQueries, TColumns extends ComponentColumns> = {
  stateSchema?: SqliteDsl.TableDefinition<string, TColumns>
  queries?: GenQueries<TQueries>
  reactDeps?: React.DependencyList
  componentKey: ComponentKeyConfig
}

const queryBuilder = new QueryBuilder()

type UseLiveStoreJsonState<TState> = <TResult>(
  jsonStringKey: keyof TState,
  parse?: (_: unknown) => TResult,
) => [value: TResult, setValue: (newVal: TResult | ((prevVal: TResult) => TResult)) => void]

export type ReactiveDrizzleSQL = <TResult>(
  genQuery: (get: GetAtom) => SQLiteSelectQueryBuilder<any, any, any, any, any, any>,
  queriedTables: string[],
) => LiveStoreSQLQuery<TResult>

export const useDrizzle = <TColumns extends ComponentColumns, TQueries extends QueryDefinitions>({
  stateSchema,
  queries = () => ({}) as TQueries,
  componentKey,
  reactDeps = [],
}: UseDrizzleLiveStoreComponentProps<TQueries, TColumns>): {
  queryResults: QueryResults<TQueries>
  state: SqliteDsl.GetRowDecodedFromColumns<TColumns>
  setState: Setters<SqliteDsl.GetRowDecodedFromColumns<TColumns>>
  useLiveStoreJsonState: UseLiveStoreJsonState<SqliteDsl.GetRowDecodedFromColumns<TColumns>>
} => {
  return useLiveStoreComponent<TColumns, TQueries>({
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
  }) as TODO
}
