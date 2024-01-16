// NOTE This file should eventually be turned into a separate package, for now it's part of the app code

import { type GetAtomResult, type LiveStoreSQLQuery, querySQL } from '@livestore/livestore'
import type { NullableFieldsToOptional } from '@livestore/utils'
// NOTE This currently requires a patch to drizzle-orm to export TypedQueryBuilder 🫠
import type { TypedQueryBuilder } from 'drizzle-orm/query-builders/query-builder'
import { QueryBuilder } from 'drizzle-orm/sqlite-core'

export * as drizzle from 'drizzle-orm'

type GetQueryRes<TQueryBuilder extends TypedQueryBuilder<any, any>> = TQueryBuilder extends TypedQueryBuilder<
  infer _A,
  infer B
>
  ? B extends (infer B2)[]
    ? NullableFieldsToOptional<B2>
    : NullableFieldsToOptional<B>
  : never

const queryBuilder = new QueryBuilder()

export const queryDrizzle = <TQueryBuilder extends TypedQueryBuilder<any, any>>(
  fn: (qb: QueryBuilder, get: GetAtomResult) => TQueryBuilder,
  options?: { queriedTables?: Set<string> },
): LiveStoreSQLQuery<ReadonlyArray<GetQueryRes<TQueryBuilder>>> => {
  return querySQL((get) => {
    const query = fn(queryBuilder, get)

    // @ts-expect-error access protected member `dialect`
    return query.dialect.sqlToQuery(query.getSQL().inlineParams()).sql
  }, options)
}
