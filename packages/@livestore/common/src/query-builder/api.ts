import type { GetValForKey } from '@livestore/utils'
import { type Option, Predicate, type Schema } from '@livestore/utils/effect'

import type { SessionIdSymbol } from '../adapter-types.js'
import type { QueryInfo } from '../query-info.js'
import type { SqliteDsl } from '../schema/db-schema/mod.js'
import type { DbSchema } from '../schema/mod.js'
import type { ClientDocumentTableDef, TableDef } from '../schema/table-def.js'
import type { SqlValue } from '../util.js'

export type QueryBuilderAst =
  | QueryBuilderAst.SelectQuery
  | QueryBuilderAst.CountQuery
  | QueryBuilderAst.RowQuery
  | QueryBuilderAst.InsertQuery
  | QueryBuilderAst.UpdateQuery
  | QueryBuilderAst.DeleteQuery

export namespace QueryBuilderAst {
  export interface SelectQuery {
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

  export interface CountQuery {
    readonly _tag: 'CountQuery'
    readonly tableDef: DbSchema.TableDefBase
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly resultSchema: Schema.Schema<number, ReadonlyArray<{ count: number }>>
  }

  export interface RowQuery {
    readonly _tag: 'RowQuery'
    readonly tableDef: DbSchema.TableDefBase
    readonly id: string | SessionIdSymbol | number
    readonly explicitDefaultValues: Record<string, unknown>
  }

  export interface InsertQuery {
    readonly _tag: 'InsertQuery'
    readonly tableDef: DbSchema.TableDefBase
    readonly values: Record<string, unknown>
    readonly onConflict: OnConflict | undefined
    readonly returning: string[] | undefined
    readonly resultSchema: Schema.Schema<any>
  }

  export interface OnConflict {
    /** Conflicting column name */
    readonly target: string
    readonly action:
      | { readonly _tag: 'ignore' }
      | { readonly _tag: 'replace' }
      | {
          readonly _tag: 'update'
          readonly update: Record<string, unknown>
        }
  }

  export interface UpdateQuery {
    readonly _tag: 'UpdateQuery'
    readonly tableDef: DbSchema.TableDefBase
    readonly values: Record<string, unknown>
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly returning: string[] | undefined
    readonly resultSchema: Schema.Schema<any>
  }

  export interface DeleteQuery {
    readonly _tag: 'DeleteQuery'
    readonly tableDef: DbSchema.TableDefBase
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly returning: string[] | undefined
    readonly resultSchema: Schema.Schema<any>
  }

  export type WriteQuery = InsertQuery | UpdateQuery | DeleteQuery

  export interface Where {
    readonly col: string
    readonly op: QueryBuilder.WhereOps
    readonly value: unknown
  }

  export interface OrderBy {
    readonly col: string
    readonly direction: 'asc' | 'desc'
  }
}

export const QueryBuilderAstSymbol = Symbol.for('QueryBuilderAst')
export type QueryBuilderAstSymbol = typeof QueryBuilderAstSymbol

export const QueryBuilderResultSymbol = Symbol.for('QueryBuilderResult')
export type QueryBuilderResultSymbol = typeof QueryBuilderResultSymbol

export const QueryBuilderTypeId = Symbol.for('QueryBuilder')
export type QueryBuilderTypeId = typeof QueryBuilderTypeId

export const isQueryBuilder = (value: unknown): value is QueryBuilder<any, any, any> =>
  Predicate.hasProperty(value, QueryBuilderTypeId)

export type QueryBuilder<
  TResult,
  TTableDef extends DbSchema.TableDefBase,
  /** Used to gradually remove features from the API based on the query context */
  TWithout extends QueryBuilder.ApiFeature = never,
  TQueryInfo extends QueryInfo = QueryInfo.None,
> = {
  readonly [QueryBuilderTypeId]: QueryBuilderTypeId
  readonly [QueryBuilderAstSymbol]: QueryBuilderAst
  readonly ['ResultType']: TResult
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

  export type ApiFeature =
    | 'select'
    | 'where'
    | 'count'
    | 'orderBy'
    | 'offset'
    | 'limit'
    | 'first'
    | 'row'
    | 'insert'
    | 'update'
    | 'delete'
    | 'returning'
    | 'onConflict'

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
        TWithout | 'row' | 'select' | 'returning' | 'onConflict',
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
        TWithout | 'row' | 'select' | 'count' | 'returning' | 'onConflict',
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
      TWithout | 'row' | 'count' | 'select' | 'orderBy' | 'first' | 'offset' | 'limit' | 'returning' | 'onConflict',
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
      ): QueryBuilder<TResult, TTableDef, TWithout | 'returning' | 'onConflict', TQueryInfo>
      <TParams extends QueryBuilder.OrderByParams<TTableDef>>(
        params: TParams,
      ): QueryBuilder<TResult, TTableDef, TWithout | 'returning' | 'onConflict', TQueryInfo>
    }

    /**
     * Example:
     * ```ts
     * db.todos.offset(10)
     * ```
     */
    readonly offset: (
      offset: number,
    ) => QueryBuilder<
      TResult,
      TTableDef,
      TWithout | 'row' | 'offset' | 'orderBy' | 'returning' | 'onConflict',
      TQueryInfo
    >

    /**
     * Example:
     * ```ts
     * db.todos.limit(10)
     * ```
     */
    readonly limit: (
      limit: number,
    ) => QueryBuilder<
      TResult,
      TTableDef,
      TWithout | 'row' | 'limit' | 'offset' | 'first' | 'orderBy' | 'returning' | 'onConflict',
      TQueryInfo
    >

    /**
     * Example:
     * ```ts
     * db.todos.first()
     * db.todos.where('id', '123').first()
     * ```
     *
     * Query will fail if no rows are returned and no fallback is provided.
     */
    readonly first: <TFallback extends GetSingle<TResult> = never>(options?: {
      fallback?: () => TFallback
    }) => QueryBuilder<
      TFallback | GetSingle<TResult>,
      TTableDef,
      TWithout | 'row' | 'first' | 'orderBy' | 'select' | 'limit' | 'offset' | 'where' | 'returning' | 'onConflict',
      TQueryInfo
    >

    /**
     * Gets a single row from the table and will create it if it doesn't exist yet.
     */
    // TODO maybe call `getsert`?
    // readonly getOrCreate: TTableDef['options']['isClientDocumentTable'] extends false
    //   ? (_: 'Error: getOrCreate() is only supported for client document tables') => any
    //   : <TOptions extends RowQuery.GetOrCreateOptions<TTableDef>>(
    //       id: RowQuery.GetIdColumnType<TTableDef> | SessionIdSymbol,
    //       opts?: TOptions,
    //     ) => QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
    // readonly getOrCreate: TTableDef['options']['isClientDocumentTable'] extends false
    //   ? (_: 'Error: getOrCreate() is only supported for client document tables') => any
    //   : TTableDef extends ClientDocumentTableDef.Trait<any, any, any, infer DOptions>
    //     ? DOptions['default']['id'] extends string | SessionIdSymbol
    //       ? <TOptions extends RowQuery.GetOrCreateOptions<TTableDef>>(
    //           id: RowQuery.GetIdColumnType<TTableDef> | SessionIdSymbol,
    //           opts?: TOptions,
    //         ) => QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
    //       : <TOptions extends RowQuery.GetOrCreateOptions<TTableDef>>(
    //           id: RowQuery.GetIdColumnType<TTableDef> | SessionIdSymbol,
    //           opts?: TOptions,
    //         ) => QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
    //     : <TOptions extends RowQuery.GetOrCreateOptions<TTableDef>>(
    //         id: RowQuery.GetIdColumnType<TTableDef> | SessionIdSymbol,
    //         opts?: TOptions,
    //       ) => QueryBuilder<RowQuery.DocumentResult<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
    // readonly getOrCreate: TTableDef['options']['isSingleton'] extends true
    //   ? () => QueryBuilder<RowQuery.Result<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
    //   : TTableDef['options']['deriveEvents']['enabled'] extends false
    //     ? (_: 'Error: Need to enable deriveEvents to use row()') => any
    //     : TTableDef['options']['requiredInsertColumnNames'] extends never
    //       ? (
    //           id: string | SessionIdSymbol | number,
    //         ) => QueryBuilder<RowQuery.Result<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>
    //       : <TOptions extends RowQuery.RequiredColumnsOptions<TTableDef>>(
    //           id: string | SessionIdSymbol | number,
    //           opts: TOptions,
    //         ) => QueryBuilder<RowQuery.Result<TTableDef>, TTableDef, QueryBuilder.ApiFeature, QueryInfo.Row>

    /**
     * Insert a new row into the table
     *
     * Example:
     * ```ts
     * db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' })
     * ```
     */
    readonly insert: (
      values: TTableDef['insertSchema']['Type'],
    ) => QueryBuilder<
      TResult,
      TTableDef,
      TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'where',
      QueryInfo.Write
    >

    /**
     * Example: If the row already exists, it will be ignored.
     * ```ts
     * db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'ignore')
     * ```
     *
     * Example: If the row already exists, it will be replaced.
     * ```ts
     * db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'replace')
     * ```
     *
     * Example: If the row already exists, it will be updated.
     * ```ts
     * db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).onConflict('id', 'update', { text: 'Buy soy milk' })
     * ```
     *
     * NOTE This API doesn't yet support composite primary keys.
     */
    readonly onConflict: {
      (
        target: string,
        action: 'ignore' | 'replace',
      ): QueryBuilder<
        TResult,
        TTableDef,
        TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'where',
        TQueryInfo
      >
      <TTarget extends keyof TTableDef['sqliteDef']['columns'] & string>(
        target: TTarget,
        action: 'update',
        updateValues: Partial<TTableDef['rowSchema']['Type']>,
      ): QueryBuilder<
        TResult,
        TTableDef,
        TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'where',
        TQueryInfo
      >
    }

    /**
     * Similar to the `.select` API but for write queries (insert, update, delete).
     *
     * Example:
     * ```ts
     * db.todos.insert({ id: '123', text: 'Buy milk', status: 'active' }).returning('id')
     * ```
     */
    readonly returning: <TColumns extends keyof TTableDef['sqliteDef']['columns'] & string>(
      ...columns: TColumns[]
    ) => QueryBuilder<
      ReadonlyArray<{
        readonly [K in TColumns]: TTableDef['sqliteDef']['columns'][K]['schema']['Type']
      }>,
      TTableDef
    >

    /**
     * Update rows in the table that match the where clause
     *
     * Example:
     * ```ts
     * db.todos.update({ status: 'completed' }).where({ id: '123' })
     * ```
     */
    readonly update: (
      values: Partial<TTableDef['rowSchema']['Type']>,
    ) => QueryBuilder<
      TResult,
      TTableDef,
      TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'onConflict',
      QueryInfo.Write
    >

    /**
     * Delete rows from the table that match the where clause
     *
     * Example:
     * ```ts
     * db.todos.delete().where({ status: 'completed' })
     * ```
     *
     * Note that it's generally recommended to do soft-deletes for synced apps.
     */
    readonly delete: () => QueryBuilder<
      TResult,
      TTableDef,
      TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'onConflict',
      QueryInfo.Write
    >
  }
}

export namespace RowQuery {
  export type GetOrCreateOptions<TTableDef extends DbSchema.ClientDocumentTableDef.TraitAny> = {
    default: Partial<TTableDef['Value']>
  }

  // TODO get rid of this
  export type RequiredColumnsOptions<TTableDef extends DbSchema.TableDefBase> = {
    /**
     * Values to be inserted into the row if it doesn't exist yet
     */
    explicitDefaultValues: Pick<
      SqliteDsl.FromColumns.RowDecodedAll<TTableDef['sqliteDef']['columns']>,
      SqliteDsl.FromColumns.RequiredInsertColumnNames<Omit<TTableDef['sqliteDef']['columns'], 'id'>>
    >
  }

  export type Result<TTableDef extends DbSchema.TableDefBase> = SqliteDsl.FromColumns.RowDecoded<
    TTableDef['sqliteDef']['columns']
  >

  export type DocumentResult<TTableDef extends DbSchema.ClientDocumentTableDef.Any> = GetValForKey<
    SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>,
    'value'
  >

  export type ResultEncoded<TTableDef extends DbSchema.TableDefBase> =
    TTableDef['options']['isClientDocumentTable'] extends true
      ? GetValForKey<SqliteDsl.FromColumns.RowEncoded<TTableDef['sqliteDef']['columns']>, 'value'>
      : SqliteDsl.FromColumns.RowEncoded<TTableDef['sqliteDef']['columns']>

  export type GetIdColumnType<TTableDef extends DbSchema.TableDefBase> =
    TTableDef['sqliteDef']['columns']['id']['schema']['Type']
}

type GetSingle<T> = T extends ReadonlyArray<infer U> ? U : never
