// NOTE This file should eventually be turned into a separate package, for now it's part of the app code

import type { GetAtomResult, LiveStoreSQLQuery, SqliteDsl } from '@livestore/livestore'
import type {
  ComponentColumns,
  ComponentKeyConfig,
  QueryDefinitions,
  QueryResults,
  Setters,
} from '@livestore/livestore/react'
import { useLiveStoreComponent } from '@livestore/livestore/react'
import type { NullableFieldsToOptional } from '@livestore/utils'
// NOTE This currently requires a patch to drizzle-orm to export TypedQueryBuilder 🫠
import type { TypedQueryBuilder } from 'drizzle-orm/query-builders/query-builder'
import { QueryBuilder } from 'drizzle-orm/sqlite-core'

import type { SQLiteSelectQueryBuilder } from './index.js'

export * as drizzle from 'drizzle-orm'

type GenQueries<TQueries> = (args: { rxSQL: ReactiveDrizzleSQL; qb: QueryBuilder }) => TQueries

type GetQueryRes<TQueryBuilder extends TypedQueryBuilder<any, any>> = TQueryBuilder extends TypedQueryBuilder<
  infer _A,
  infer B
>
  ? B extends (infer B2)[]
    ? NullableFieldsToOptional<B2>
    : NullableFieldsToOptional<B>
  : never

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

export type ReactiveDrizzleSQL = <TQueryBuilder extends SQLiteSelectQueryBuilder<any, any, any, any, any, any>>(
  genQuery: (get: GetAtomResult) => TQueryBuilder,
  queriedTables: string[],
) => LiveStoreSQLQuery<GetQueryRes<TQueryBuilder>>

export const useDrizzle = <TColumns extends ComponentColumns, TQueries extends QueryDefinitions>({
  stateSchema,
  queries = () => ({}) as TQueries,
  componentKey,
  reactDeps = [],
}: UseDrizzleLiveStoreComponentProps<TQueries, TColumns>): {
  queryResults: QueryResults<TQueries>
  state: SqliteDsl.FromColumns.RowDecoded<TColumns>
  setState: Setters<SqliteDsl.FromColumns.RowDecoded<TColumns>>
  useLiveStoreJsonState: UseLiveStoreJsonState<SqliteDsl.FromColumns.RowDecoded<TColumns>>
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
