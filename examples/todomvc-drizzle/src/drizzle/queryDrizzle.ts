// NOTE This file should eventually be turned into a separate package, for now it's part of the app code

import type { GetAtomResult, LiveQuery, MapRows } from '@livestore/livestore'
import { querySQL } from '@livestore/livestore'
import type { NullableFieldsToOptional } from '@livestore/utils'
// NOTE This currently requires a patch to drizzle-orm to export TypedQueryBuilder 🫠
import type { TypedQueryBuilder } from 'drizzle-orm/query-builders/query-builder'
import { QueryBuilder } from 'drizzle-orm/sqlite-core'

export * as drizzle from 'drizzle-orm'

// NOTE This separate `GetQueryResNonOptional` type is a workaround for the `Invariant` requirement of Effect Schema
type GetQueryResNonOptional<TQueryBuilder extends TypedQueryBuilder<any, any>> =
  TQueryBuilder extends TypedQueryBuilder<infer _A, infer B> ? (B extends (infer B2)[] ? B2 : B) : never

type GetQueryRes<TQueryBuilder extends TypedQueryBuilder<any, any>> = TQueryBuilder extends TypedQueryBuilder<
  infer _A,
  infer B
>
  ? B extends (infer B2)[]
    ? NullableFieldsToOptional<B2>
    : NullableFieldsToOptional<B>
  : never

const queryBuilder = new QueryBuilder()

export const queryDrizzle: {
  <TQueryBuilder extends TypedQueryBuilder<any, any>>(
    fn: (qb: QueryBuilder, get: GetAtomResult) => TQueryBuilder,
    options?: {
      queriedTables?: Set<string>
    },
  ): LiveQuery<ReadonlyArray<GetQueryRes<TQueryBuilder>>>
  <TQueryBuilder extends TypedQueryBuilder<any, any>, TResult>(
    fn: (qb: QueryBuilder, get: GetAtomResult) => TQueryBuilder,
    options: {
      queriedTables?: Set<string>
      map?: MapRows<TResult, GetQueryResNonOptional<TQueryBuilder>>
    },
  ): LiveQuery<TResult>
} = (fn: any, options: any) => {
  return querySQL((get) => {
    const query = fn(queryBuilder, get) as TypedQueryBuilder<any, any>

    // @ts-expect-error access protected member `dialect`
    return query.dialect.sqlToQuery(query.getSQL().inlineParams()).sql
  }, options) as any
}
