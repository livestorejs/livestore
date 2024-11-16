import type { Option, Schema } from '@livestore/utils/effect'

import type { DefaultSqliteTableDef } from '../schema/table-def.js'

export type QueryBuilderAst = QueryBuilderAst.SelectQuery | QueryBuilderAst.CountQuery

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
    readonly tableDef: DefaultSqliteTableDef
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly resultSchemaSingle: Schema.Schema<any>
  }

  export type CountQuery = {
    readonly _tag: 'CountQuery'
    readonly tableDef: DefaultSqliteTableDef
    readonly where: ReadonlyArray<QueryBuilderAst.Where>
    readonly resultSchema: Schema.Schema<number, ReadonlyArray<{ count: number }>>
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
export const QueryBuilderSymbol = Symbol.for('QueryBuilder')
export type QueryBuilderSymbol = typeof QueryBuilderSymbol

export type QueryBuilder<
  TResult,
  TSqliteDef extends DefaultSqliteTableDef,
  TWithout extends QueryBuilder.ApiFeature = never,
> = {
  readonly [QueryBuilderSymbol]: QueryBuilderSymbol
  readonly [QueryBuilderAstSymbol]: QueryBuilderAst
  readonly asSql: () => { query: string; bindValues: unknown[] }
  readonly toString: () => string
} & Omit<QueryBuilder.ApiFull<TResult, TSqliteDef, TWithout>, TWithout>

export namespace QueryBuilder {
  export type WhereOps = WhereOps.Equality | WhereOps.Order | WhereOps.Like | WhereOps.In

  export namespace WhereOps {
    export type Equality = '=' | '!='
    export type Order = '<' | '>' | '<=' | '>='
    export type Like = 'LIKE' | 'NOT LIKE' | 'ILIKE' | 'NOT ILIKE'
    export type In = 'IN' | 'NOT IN'

    export type SingleValue = Equality | Order | Like
    export type MultiValue = In
  }

  export type ApiFeature = 'select' | 'pluck' | 'count' | 'orderBy' | 'offset' | 'limit' | 'first' | 'where'

  // export type WhereParams<TSqliteDef extends DefaultSqliteTableDef> =
  //   | { col: string; op: QueryBuilder.SimpleOperator; value: TSqliteDef['columns'][string]['schema']['Type'] }
  //   | { col: string; value: TSqliteDef['columns'][string]['schema']['Type'] }

  export type WhereParams<TSqliteDef extends DefaultSqliteTableDef> = Partial<{
    [K in keyof TSqliteDef['columns']]:
      | TSqliteDef['columns'][K]['schema']['Type']
      | { op: QueryBuilder.WhereOps.SingleValue; value: TSqliteDef['columns'][K]['schema']['Type'] }
      | { op: QueryBuilder.WhereOps.MultiValue; value: ReadonlyArray<TSqliteDef['columns'][K]['schema']['Type']> }
      | undefined
  }>

  export type OrderByParams<TSqliteDef extends DefaultSqliteTableDef> = ReadonlyArray<{
    col: keyof TSqliteDef['columns'] & string
    direction: 'asc' | 'desc'
  }>

  export type ApiFull<TResult, TSqliteDef extends DefaultSqliteTableDef, TWithout extends ApiFeature> = {
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
      <TColumn extends keyof TSqliteDef['columns'] & string, TPluck extends boolean = false>(
        column: TColumn,
        options?: { pluck: TPluck },
      ): QueryBuilder<
        TPluck extends true
          ? ReadonlyArray<TSqliteDef['columns'][TColumn]['schema']['Type']>
          : ReadonlyArray<{
              [K in TColumn]: TSqliteDef['columns'][K]['schema']['Type']
            }>,
        TSqliteDef,
        TWithout | 'select'
      >
      <TColumns extends keyof TSqliteDef['columns'] & string>(
        ...columns: TColumns[]
        // TODO also support arbitrary SQL selects
        // params: QueryBuilderSelectParams,
      ): QueryBuilder<
        ReadonlyArray<{
          [K in TColumns]: TSqliteDef['columns'][K]['schema']['Type']
        }>,
        TSqliteDef,
        TWithout | 'select' | 'count'
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
      <TParams extends QueryBuilder.WhereParams<TSqliteDef>>(
        params: TParams,
      ): QueryBuilder<TResult, TSqliteDef, TWithout | 'select'>
      <TColName extends keyof TSqliteDef['columns']>(
        col: TColName,
        value: TSqliteDef['columns'][TColName]['schema']['Type'],
      ): QueryBuilder<TResult, TSqliteDef, TWithout | 'select'>
      <TColName extends keyof TSqliteDef['columns']>(
        col: TColName,
        op: QueryBuilder.WhereOps,
        value: TSqliteDef['columns'][TColName]['schema']['Type'],
      ): QueryBuilder<TResult, TSqliteDef, TWithout | 'select'>
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
      TSqliteDef,
      TWithout | 'count' | 'select' | 'orderBy' | 'first' | 'offset' | 'limit'
    >

    /**
     * Example:
     * ```ts
     * db.todos.orderBy('createdAt', 'desc')
     * ```
     */
    readonly orderBy: {
      <TColName extends keyof TSqliteDef['columns'] & string>(
        col: TColName,
        direction: 'asc' | 'desc',
      ): QueryBuilder<TResult, TSqliteDef, TWithout>
      <TParams extends QueryBuilder.OrderByParams<TSqliteDef>>(
        params: TParams,
      ): QueryBuilder<TResult, TSqliteDef, TWithout>
    }

    /**
     * Example:
     * ```ts
     * db.todos.offset(10)
     * ```
     */
    readonly offset: (offset: number) => QueryBuilder<TResult, TSqliteDef, TWithout | 'offset' | 'orderBy'>

    /**
     * Example:
     * ```ts
     * db.todos.limit(10)
     * ```
     */
    readonly limit: (
      limit: number,
    ) => QueryBuilder<TResult, TSqliteDef, TWithout | 'limit' | 'offset' | 'first' | 'orderBy'>

    /**
     * Example:
     * ```ts
     * db.todos.first()
     * ```
     */
    readonly first: <TFallback extends GetSingle<TResult> = never>(
      fallback?: () => TFallback,
    ) => QueryBuilder<
      TFallback | GetSingle<TResult>,
      TSqliteDef,
      TWithout | 'first' | 'orderBy' | 'select' | 'limit' | 'offset' | 'where'
    >
  }
}

type GetSingle<T> = T extends ReadonlyArray<infer U> ? U : never

// export type QueryBuilderParamRef = { _tag: 'QueryBuilderParamRef' }
// export type QueryBuilderSelectParams = { [key: string]: QueryBuilderSelectParam }
// export type QueryBuilderSelectParam = boolean | ((ref: QueryBuilderParamRef) => QueryBuilder<any, any>)
