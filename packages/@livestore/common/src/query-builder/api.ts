import type { GetValForKey } from '@livestore/utils'
import { type Option, Predicate, type Schema } from '@livestore/utils/effect'

import type { SessionIdSymbol } from '../adapter-types.js'
import type { QueryInfo } from '../query-info.js'
import type { DbSchema } from '../schema/mod.js'
import type { SqliteDsl } from '../schema/table-def.js'
import type { SqlValue } from '../util.js'

export type QueryBuilderAst = QueryBuilderAst.SelectQuery | QueryBuilderAst.CountQuery | QueryBuilderAst.RowQuery

export namespace QueryBuilderAst {
  export type SelectQuery = {
    readonly _tag: 'SelectQuery'
    readonly columns: string[]
    readonly pickFirst: false | { fallback: () => any }
    readonly select: {
      columns: ReadonlyArray<string>
    }
    readonly orderBy: ReadonlyArray<OrderBy>
    readonly offset: Option.Option<number>
    readonly limit: Option.Option<number>
    readonly tableDef: DbSchema.TableDefBase
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly resultSchemaSingle: Schema.Schema<any>
  }

  export type CountQuery = {
    readonly _tag: 'CountQuery'
    readonly tableDef: DbSchema.TableDefBase
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly resultSchema: Schema.Schema<number, ReadonlyArray<{ count: number }>>
  }

  export type RowQuery = {
    readonly _tag: 'RowQuery'
    readonly tableDef: DbSchema.TableDefBase
    readonly id: string | SessionIdSymbol | number
    readonly insertValues: Record<string, unknown>
  }

  export type Where = {
    readonly col: string
    readonly op: QueryBuilder.WhereOps
    readonly value: unknown
  }

  export type OrderBy = {
    readonly col: string
    readonly direction: 'asc' | 'desc'
  }
}

export const QueryBuilderAstSymbol = Symbol.for('QueryBuilderAst')
export type QueryBuilderAstSymbol = typeof QueryBuilderAstSymbol
export const TypeId = Symbol.for('QueryBuilder')
export type TypeId = typeof TypeId

export const isQueryBuilder = (value: unknown): value is QueryBuilder<any, any, any> =>
  Predicate.hasProperty(value, TypeId)

export type QueryBuilder<
  TResult,
  TTableDef extends DbSchema.TableDefBase,
  /** Used to gradually remove features from the API based on the query context */
  TWithout extends QueryBuilder.ApiFeature = never,
  TQueryInfo extends QueryInfo = QueryInfo.None,
> = {
  readonly [TypeId]: TypeId
  readonly [QueryBuilderAstSymbol]: QueryBuilderAst
  readonly asSql: () => { query: string; bindValues: SqlValue[] }
  readonly toString: () => string
} & Omit<QueryBuilder.ApiFull<TResult, TTableDef, TWithout, TQueryInfo>, TWithout>

export namespace QueryBuilder {
  export type Any = QueryBuilder<any, any, any, any>
  export type WhereOps = WhereOps.Equality | WhereOps.Order | WhereOps.Like | WhereOps.In

  export namespace WhereOps {
    export type Equality = '=' | '!='
    export type Order = '<' | '>' | '<=' | '>='
    export type Like = 'LIKE' | 'NOT LIKE' | 'ILIKE' | 'NOT ILIKE'
    export type In = 'IN' | 'NOT IN'

    export type SingleValue = Equality | Order | Like
    export type MultiValue = In
  }

  export type ApiFeature = 'select' | 'where' | 'count' | 'orderBy' | 'offset' | 'limit' | 'first' | 'row'

  export type WhereParams<TTableDef extends DbSchema.TableDefBase> = Partial<{
    [K in keyof TTableDef['sqliteDef']['columns']]:
      | TTableDef['sqliteDef']['columns'][K]['schema']['Type']
      | { op: QueryBuilder.WhereOps.SingleValue; value: TTableDef['sqliteDef']['columns'][K]['schema']['Type'] }
      | {
          op: QueryBuilder.WhereOps.MultiValue
          value: ReadonlyArray<TTableDef['sqliteDef']['columns'][K]['schema']['Type']>
        }
      | undefined
  }>

  export type OrderByParams<TTableDef extends DbSchema.TableDefBase> = ReadonlyArray<{
    col: keyof TTableDef['sqliteDef']['columns'] & string
    direction: 'asc' | 'desc'
  }>

  export type ApiFull<
    TResult,
    TTableDef extends DbSchema.TableDefBase,
    TWithout extends ApiFeature,
    TQueryInfo extends QueryInfo,
  > = {
    /**
     * `SELECT *` is the default
     *
     * Example:
     * ```ts
     * db.todos.select('id', 'text', 'completed')
     * db.todos.select('id', { pluck: true })
     * ```
     */
    readonly select: {
      <TColumn extends keyof TTableDef['sqliteDef']['columns'] & string, TPluck extends boolean = false>(
        column: TColumn,
        options?: { pluck: TPluck },
      ): QueryBuilder<
        TPluck extends true
          ? ReadonlyArray<TTableDef['sqliteDef']['columns'][TColumn]['schema']['Type']>
          : ReadonlyArray<{
              readonly [K in TColumn]: TTableDef['sqliteDef']['columns'][K]['schema']['Type']
            }>,
        TTableDef,
        TWithout | 'row' | 'select',
        TQueryInfo
      >
      <TColumns extends keyof TTableDef['sqliteDef']['columns'] & string>(
        ...columns: TColumns[]
        // TODO also support arbitrary SQL selects
        // params: QueryBuilderSelectParams,
      ): QueryBuilder<
        ReadonlyArray<{
          readonly [K in TColumns]: TTableDef['sqliteDef']['columns'][K]['schema']['Type']
        }>,
        TTableDef,
        TWithout | 'row' | 'select' | 'count',
        TQueryInfo
      >
    }

    /**
     * Notes:
     * - All where clauses are `AND`ed together by default.
     * - `null` values only support `=` and `!=` which is translated to `IS NULL` and `IS NOT NULL`.
     *
     * Example:
     * ```ts
     * db.todos.where('completed', true)
     * db.todos.where('completed', '!=', true)
     * db.todos.where({ completed: true })
     * db.todos.where({ completed: { op: '!=', value: true } })
     * ```
     *
     * TODO: Also support `OR`
     */
    readonly where: {
      <TParams extends QueryBuilder.WhereParams<TTableDef>>(
        params: TParams,
      ): QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'select', TQueryInfo>
      <TColName extends keyof TTableDef['sqliteDef']['columns']>(
        col: TColName,
        value: TTableDef['sqliteDef']['columns'][TColName]['schema']['Type'],
      ): QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'select', TQueryInfo>
      <TColName extends keyof TTableDef['sqliteDef']['columns']>(
        col: TColName,
        op: QueryBuilder.WhereOps,
        value: TTableDef['sqliteDef']['columns'][TColName]['schema']['Type'],
      ): QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'select', TQueryInfo>
    }

    /**
     * Example:
     * ```ts
     * db.todos.count()
     * db.todos.count().where('completed', true)
     * ```
     */
    readonly count: () => QueryBuilder<
      number,
      TTableDef,
      TWithout | 'row' | 'count' | 'select' | 'orderBy' | 'first' | 'offset' | 'limit',
      TQueryInfo
    >

    /**
     * Example:
     * ```ts
     * db.todos.orderBy('createdAt', 'desc')
     * ```
     */
    readonly orderBy: {
      <TColName extends keyof TTableDef['sqliteDef']['columns'] & string>(
        col: TColName,
        direction: 'asc' | 'desc',
      ): QueryBuilder<TResult, TTableDef, TWithout, TQueryInfo>
      <TParams extends QueryBuilder.OrderByParams<TTableDef>>(
        params: TParams,
      ): QueryBuilder<TResult, TTableDef, TWithout, TQueryInfo>
    }

    /**
     * Example:
     * ```ts
     * db.todos.offset(10)
     * ```
     */
    readonly offset: (
      offset: number,
    ) => QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'offset' | 'orderBy', TQueryInfo>

    /**
     * Example:
     * ```ts
     * db.todos.limit(10)
     * ```
     */
    readonly limit: (
      limit: number,
    ) => QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'limit' | 'offset' | 'first' | 'orderBy', TQueryInfo>

    /**
     * Example:
     * ```ts
     * db.todos.first()
     * ```
     */
    readonly first: <TFallback extends GetSingle<TResult> = never>(options?: {
      fallback?: () => TFallback
    }) => QueryBuilder<
      TFallback | GetSingle<TResult>,
      TTableDef,
      TWithout | 'row' | 'first' | 'orderBy' | 'select' | 'limit' | 'offset' | 'where',
      TQueryInfo
    >

    /**
     * Gets a single row from the table and will create it if it doesn't exist yet.
     */
    // TODO maybe call `getsert`?
    readonly row: TTableDef['options']['isSingleton'] extends true
      ? () => QueryBuilder<RowQuery.Result<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
      : TTableDef['options']['deriveMutations']['enabled'] extends false
        ? (_: 'Error: Need to enable deriveMutations to use row()') => any
        : TTableDef['options']['requiredInsertColumnNames'] extends never
          ? (
              id: string | SessionIdSymbol | number,
            ) => QueryBuilder<RowQuery.Result<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
          : <TOptions extends RowQuery.RequiredColumnsOptions<TTableDef>>(
              id: string | SessionIdSymbol | number,
              opts: TOptions,
            ) => QueryBuilder<RowQuery.Result<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
  }
}

export namespace RowQuery {
  export type RequiredColumnsOptions<TTableDef extends DbSchema.TableDefBase> = {
    /**
     * Values to be inserted into the row if it doesn't exist yet
     */
    insertValues: Pick<
      SqliteDsl.FromColumns.RowDecodedAll<TTableDef['sqliteDef']['columns']>,
      SqliteDsl.FromColumns.RequiredInsertColumnNames<Omit<TTableDef['sqliteDef']['columns'], 'id'>>
    >
  }

  export type Result<TTableDef extends DbSchema.TableDefBase> = TTableDef['options']['isSingleColumn'] extends true
    ? GetValForKey<SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>, 'value'>
    : SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>

  export type ResultEncoded<TTableDef extends DbSchema.TableDefBase> =
    TTableDef['options']['isSingleColumn'] extends true
      ? GetValForKey<SqliteDsl.FromColumns.RowEncoded<TTableDef['sqliteDef']['columns']>, 'value'>
      : SqliteDsl.FromColumns.RowEncoded<TTableDef['sqliteDef']['columns']>
}

type GetSingle<T> = T extends ReadonlyArray<infer U> ? U : never

// export type QueryBuilderParamRef = { _tag: 'QueryBuilderParamRef' }
// export type QueryBuilderSelectParams = { [key: string]: QueryBuilderSelectParam }
// export type QueryBuilderSelectParam = boolean | ((ref: QueryBuilderParamRef) => QueryBuilder<any, any>)
