import type { GetValForKey, SingleOrReadonlyArray } from '@livestore/utils'
import { type Option, Predicate, type Schema } from '@livestore/utils/effect'

import type { SessionIdSymbol } from '../../../../adapter-types.js'
import type { SqlValue } from '../../../../util.js'
import type { ClientDocumentTableDef } from '../client-document-def.js'
import type { SqliteDsl } from '../db-schema/mod.js'
import type { TableDefBase } from '../table-def.js'

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
    readonly pickFirst:
      | { _tag: 'disabled' }
      | { _tag: 'enabled'; behaviour: 'undefined' }
      | { _tag: 'enabled'; behaviour: 'error' }
      | { _tag: 'enabled'; behaviour: 'fallback'; fallback: () => any }
    readonly select: {
      columns: ReadonlyArray<string>
    }
    readonly orderBy: ReadonlyArray<OrderBy>
    readonly offset: Option.Option<number>
    readonly limit: Option.Option<number>
    readonly tableDef: TableDefBase
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly resultSchemaSingle: Schema.Schema<any>
  }

  export interface CountQuery {
    readonly _tag: 'CountQuery'
    readonly tableDef: TableDefBase
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly resultSchema: Schema.Schema<number, ReadonlyArray<{ count: number }>>
  }

  export interface RowQuery {
    readonly _tag: 'RowQuery'
    readonly tableDef: ClientDocumentTableDef.Any
    readonly id: string | SessionIdSymbol
    readonly explicitDefaultValues: Record<string, unknown>
  }

  export interface InsertQuery {
    readonly _tag: 'InsertQuery'
    readonly tableDef: TableDefBase
    readonly values: Record<string, unknown>
    readonly onConflict: OnConflict | undefined
    readonly returning: string[] | undefined
    readonly resultSchema: Schema.Schema<any>
  }

  export interface OnConflict {
    /** Conflicting column name */
    readonly targets: string[]
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
    readonly tableDef: TableDefBase
    readonly values: Record<string, unknown>
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly returning: string[] | undefined
    readonly resultSchema: Schema.Schema<any>
  }

  export interface DeleteQuery {
    readonly _tag: 'DeleteQuery'
    readonly tableDef: TableDefBase
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
  TTableDef extends TableDefBase,
  /** Used to gradually remove features from the API based on the query context */
  TWithout extends QueryBuilder.ApiFeature = never,
> = {
  readonly [QueryBuilderTypeId]: QueryBuilderTypeId
  readonly [QueryBuilderAstSymbol]: QueryBuilderAst
  readonly ResultType: TResult
  readonly asSql: () => { query: string; bindValues: SqlValue[] }
  readonly toString: () => string
} & Omit<QueryBuilder.ApiFull<TResult, TTableDef, TWithout>, TWithout>

export namespace QueryBuilder {
  export type Any = QueryBuilder<any, any, any>
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

  export type WhereParams<TTableDef extends TableDefBase> = Partial<{
    [K in keyof TTableDef['sqliteDef']['columns']]:
      | TTableDef['sqliteDef']['columns'][K]['schema']['Type']
      | { op: QueryBuilder.WhereOps.SingleValue; value: TTableDef['sqliteDef']['columns'][K]['schema']['Type'] }
      | {
          op: QueryBuilder.WhereOps.MultiValue
          value: ReadonlyArray<TTableDef['sqliteDef']['columns'][K]['schema']['Type']>
        }
      | undefined
  }>

  export type OrderByParams<TTableDef extends TableDefBase> = ReadonlyArray<{
    col: keyof TTableDef['sqliteDef']['columns'] & string
    direction: 'asc' | 'desc'
  }>

  export type FirstQueryBehaviour<TResult, TFallback> =
    | {
        /** Will error if no matching row was found */
        behaviour: 'error'
      }
    | {
        /** Will return `undefined` if no matching row was found */
        behaviour: 'undefined'
      }
    | {
        /** Will return a fallback value if no matching row was found */
        behaviour: 'fallback'
        fallback: () => TResult | TFallback
      }

  export type ApiFull<TResult, TTableDef extends TableDefBase, TWithout extends ApiFeature> = {
    /**
     * `SELECT *` is the default
     *
     * Example:
     * ```ts
     * db.todos.select('id', 'text', 'completed')
     * db.todos.select('id')
     * ```
     */
    readonly select: {
      /** Selects and plucks a single column */
      <TColumn extends keyof TTableDef['sqliteDef']['columns'] & string>(
        pluckColumn: TColumn,
      ): QueryBuilder<
        ReadonlyArray<TTableDef['sqliteDef']['columns'][TColumn]['schema']['Type']>,
        TTableDef,
        TWithout | 'row' | 'select' | 'returning' | 'onConflict'
      >
      /** Select multiple columns */
      <TColumns extends keyof TTableDef['sqliteDef']['columns'] & string>(
        ...columns: TColumns[]
        // TODO also support arbitrary SQL selects
        // params: QueryBuilderSelectParams,
      ): QueryBuilder<
        ReadonlyArray<{
          readonly [K in TColumns]: TTableDef['sqliteDef']['columns'][K]['schema']['Type']
        }>,
        TTableDef,
        TWithout | 'row' | 'select' | 'count' | 'returning' | 'onConflict'
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
      (params: QueryBuilder.WhereParams<TTableDef>): QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'select'>
      <TColName extends keyof TTableDef['sqliteDef']['columns']>(
        col: TColName,
        value: TTableDef['sqliteDef']['columns'][TColName]['schema']['Type'],
      ): QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'select'>
      <TColName extends keyof TTableDef['sqliteDef']['columns']>(
        col: TColName,
        op: QueryBuilder.WhereOps,
        value: TTableDef['sqliteDef']['columns'][TColName]['schema']['Type'],
      ): QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'select'>
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
      TWithout | 'row' | 'count' | 'select' | 'orderBy' | 'first' | 'offset' | 'limit' | 'returning' | 'onConflict'
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
      ): QueryBuilder<TResult, TTableDef, TWithout | 'returning' | 'onConflict'>
      <TParams extends QueryBuilder.OrderByParams<TTableDef>>(
        params: TParams,
      ): QueryBuilder<TResult, TTableDef, TWithout | 'returning' | 'onConflict'>
    }

    /**
     * Example:
     * ```ts
     * db.todos.offset(10)
     * ```
     */
    readonly offset: (
      offset: number,
    ) => QueryBuilder<TResult, TTableDef, TWithout | 'row' | 'offset' | 'orderBy' | 'returning' | 'onConflict'>

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
      TWithout | 'row' | 'limit' | 'offset' | 'first' | 'orderBy' | 'returning' | 'onConflict'
    >

    /**
     * Example:
     * ```ts
     * db.todos.first()
     * db.todos.where('id', '123').first() // will return `undefined` if no rows are returned
     * db.todos.where('id', '123').first({ behaviour: 'error' }) // will throw if no rows are returned
     * db.todos.first({ behaviour: 'fallback', fallback: () => ({ id: '123', text: 'Buy milk', status: 'active' }) })
     * ```
     *
     * Behaviour:
     * - `undefined`: Will return `undefined` if no rows are returned (default behaviour)
     * - `error`: Will throw if no rows are returned
     * - `fallback`: Will return a fallback value if no rows are returned
     */
    readonly first: <
      TBehaviour extends QueryBuilder.FirstQueryBehaviour<GetSingle<TResult>, TFallback>,
      TFallback = never,
    >(
      behaviour?: QueryBuilder.FirstQueryBehaviour<GetSingle<TResult>, TFallback> & TBehaviour,
    ) => QueryBuilder<
      TBehaviour extends { behaviour: 'fallback' }
        ? ReturnType<TBehaviour['fallback']> | GetSingle<TResult>
        : TBehaviour extends { behaviour: 'undefined' }
          ? undefined | GetSingle<TResult>
          : GetSingle<TResult>,
      TTableDef,
      TWithout | 'row' | 'first' | 'orderBy' | 'select' | 'limit' | 'offset' | 'where' | 'returning' | 'onConflict'
    >

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
      TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'where'
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
      <TTarget extends SingleOrReadonlyArray<keyof TTableDef['sqliteDef']['columns']>>(
        target: TTarget,
        action: 'ignore' | 'replace',
      ): QueryBuilder<
        TResult,
        TTableDef,
        TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'where'
      >
      <TTarget extends SingleOrReadonlyArray<keyof TTableDef['sqliteDef']['columns']>>(
        target: TTarget,
        action: 'update',
        updateValues: Partial<TTableDef['rowSchema']['Type']>,
      ): QueryBuilder<
        TResult,
        TTableDef,
        TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'where'
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
      TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'onConflict'
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
      TWithout | 'row' | 'select' | 'count' | 'orderBy' | 'first' | 'offset' | 'limit' | 'onConflict'
    >
  }
}

export namespace RowQuery {
  export type GetOrCreateOptions<TTableDef extends ClientDocumentTableDef.TraitAny> = {
    default: Partial<TTableDef['Value']>
  }

  // TODO get rid of this
  export type RequiredColumnsOptions<TTableDef extends TableDefBase> = {
    /**
     * Values to be inserted into the row if it doesn't exist yet
     */
    explicitDefaultValues: Pick<
      SqliteDsl.FromColumns.RowDecodedAll<TTableDef['sqliteDef']['columns']>,
      SqliteDsl.FromColumns.RequiredInsertColumnNames<Omit<TTableDef['sqliteDef']['columns'], 'id'>>
    >
  }

  export type Result<TTableDef extends TableDefBase> = SqliteDsl.FromColumns.RowDecoded<
    TTableDef['sqliteDef']['columns']
  >

  export type DocumentResult<TTableDef extends ClientDocumentTableDef.Any> = GetValForKey<
    SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>,
    'value'
  >

  export type ResultEncoded<TTableDef extends TableDefBase> = TTableDef['options']['isClientDocumentTable'] extends true
    ? GetValForKey<SqliteDsl.FromColumns.RowEncoded<TTableDef['sqliteDef']['columns']>, 'value'>
    : SqliteDsl.FromColumns.RowEncoded<TTableDef['sqliteDef']['columns']>

  export type GetIdColumnType<TTableDef extends TableDefBase> =
    TTableDef['sqliteDef']['columns']['id']['schema']['Type']
}

type GetSingle<T> = T extends ReadonlyArray<infer U> ? U : never
