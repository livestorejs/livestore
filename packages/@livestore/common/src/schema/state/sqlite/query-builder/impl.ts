import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import { Match, Option, Predicate, Schema } from '@livestore/utils/effect'

import type { TableDefBase } from '../table-def.js'
import type { QueryBuilder, QueryBuilderAst } from './api.js'
import { QueryBuilderAstSymbol, QueryBuilderTypeId } from './api.js'
import { astToSql } from './astToSql.js'
export const makeQueryBuilder = <TResult, TTableDef extends TableDefBase>(
  tableDef: TTableDef,
  ast: QueryBuilderAst = emptyAst(tableDef),
): QueryBuilder<TResult, TTableDef, never> => {
  const api = {
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    select() {
      assertSelectQueryBuilderAst(ast)

      // eslint-disable-next-line prefer-rest-params
      const params = [...arguments]

      // Pluck if there's only one column selected
      if (params.length === 1) {
        const [col] = params as any as [string]
        return makeQueryBuilder(tableDef, {
          ...ast,
          resultSchemaSingle: ast.resultSchemaSingle.pipe(Schema.pluck(col)),
          select: { columns: [col] },
        })
      }

      const columns = params as unknown as ReadonlyArray<string>

      return makeQueryBuilder(tableDef, {
        ...ast,
        resultSchemaSingle:
          columns.length === 0 ? ast.resultSchemaSingle : ast.resultSchemaSingle.pipe(Schema.pick(...columns)),
        select: { columns },
      }) as any
    },
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    where: function () {
      if (ast._tag === 'InsertQuery') return invalidQueryBuilder('Cannot use where with insert')
      if (ast._tag === 'RowQuery') return invalidQueryBuilder('Cannot use where with row')

      if (arguments.length === 1) {
        // eslint-disable-next-line prefer-rest-params
        const params = arguments[0]
        const newOps = Object.entries(params)
          .filter(([, value]) => value !== undefined)
          .map<QueryBuilderAst.Where>(([col, value]) =>
            Predicate.hasProperty(value, 'op') && Predicate.hasProperty(value, 'value')
              ? ({ col, op: value.op, value: value.value } as any)
              : { col, op: '=', value },
          )

        switch (ast._tag) {
          case 'CountQuery':
          case 'SelectQuery':
          case 'UpdateQuery':
          case 'DeleteQuery': {
            return makeQueryBuilder(tableDef, {
              ...ast,
              where: [...ast.where, ...newOps],
            }) as any
          }
          default: {
            return casesHandled(ast)
          }
        }
      }

      // eslint-disable-next-line prefer-rest-params
      const [col, opOrValue, valueOrUndefined] = arguments
      const op = valueOrUndefined === undefined ? '=' : opOrValue
      const value = valueOrUndefined === undefined ? opOrValue : valueOrUndefined

      switch (ast._tag) {
        case 'CountQuery':
        case 'SelectQuery':
        case 'UpdateQuery':
        case 'DeleteQuery': {
          return makeQueryBuilder(tableDef, {
            ...ast,
            where: [...ast.where, { col, op, value }],
          }) as any
        }
        default: {
          return casesHandled(ast)
        }
      }
    },
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    orderBy() {
      assertSelectQueryBuilderAst(ast)

      if (arguments.length === 0 || arguments.length > 2) return invalidQueryBuilder()

      if (arguments.length === 1) {
        // eslint-disable-next-line prefer-rest-params
        const params = arguments[0] as QueryBuilder.OrderByParams<TTableDef>
        return makeQueryBuilder(tableDef, {
          ...ast,
          orderBy: [...ast.orderBy, ...params],
        })
      }

      // eslint-disable-next-line prefer-rest-params
      const [col, direction] = arguments as any as [keyof TTableDef['sqliteDef']['columns'] & string, 'asc' | 'desc']

      return makeQueryBuilder(tableDef, {
        ...ast,
        orderBy: [...ast.orderBy, { col, direction }],
      }) as any
    },
    limit: (limit) => {
      assertSelectQueryBuilderAst(ast)

      return makeQueryBuilder(tableDef, { ...ast, limit: Option.some(limit) })
    },
    offset: (offset) => {
      assertSelectQueryBuilderAst(ast)

      return makeQueryBuilder(tableDef, { ...ast, offset: Option.some(offset) })
    },
    count: () => {
      if (isRowQuery(ast)) return invalidQueryBuilder()

      return makeQueryBuilder(tableDef, {
        _tag: 'CountQuery',
        tableDef,
        where: [],
        resultSchema: Schema.Struct({ count: Schema.Number }).pipe(
          Schema.pluck('count'),
          Schema.Array,
          Schema.headOrElse(),
        ),
      })
    },
    first: (options) => {
      assertSelectQueryBuilderAst(ast)

      if (ast.limit._tag === 'Some') return invalidQueryBuilder(`.first() can't be called after .limit()`)

      return makeQueryBuilder(tableDef, {
        ...ast,
        limit: Option.some(1),
        pickFirst:
          options?.fallback !== undefined && options.fallback !== 'throws' ? { fallback: options.fallback } : 'throws',
      })
    },
    // // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    // getOrCreate() {
    //   if (tableDef.options.isClientDocumentTable === false) {
    //     return invalidQueryBuilder(`getOrCreate() is not allowed when table is not a client document table`)
    //   }

    //   // eslint-disable-next-line prefer-rest-params
    //   const params = [...arguments]

    //   let id: string | number

    //   // TODO refactor to handle default id
    //   id = params[0] as string | number
    //   if (id === undefined) {
    //     invalidQueryBuilder(`Id missing for row query on non-singleton table ${tableDef.sqliteDef.name}`)
    //   }

    //   // TODO validate all required columns are present and values are matching the schema
    //   const insertValues: Record<string, unknown> = params[1]?.insertValues ?? {}

    //   return makeQueryBuilder(tableDef, {
    //     _tag: 'RowQuery',
    //     id,
    //     tableDef,
    //     insertValues,
    //   }) as any
    // },
    insert: (values) => {
      const filteredValues = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

      return makeQueryBuilder(tableDef, {
        _tag: 'InsertQuery',
        tableDef,
        values: filteredValues,
        onConflict: undefined,
        returning: undefined,
        resultSchema: Schema.Void,
      }) as any
    },
    onConflict: (
      targetOrTargets: string | string[],
      action: 'ignore' | 'replace' | 'update',
      updateValues?: Record<string, unknown>,
    ) => {
      const targets = Array.isArray(targetOrTargets) ? targetOrTargets : [targetOrTargets]

      assertInsertQueryBuilderAst(ast)

      const onConflict = Match.value(action).pipe(
        Match.when('ignore', () => ({ targets, action: { _tag: 'ignore' } }) satisfies QueryBuilderAst.OnConflict),
        Match.when('replace', () => ({ targets, action: { _tag: 'replace' } }) satisfies QueryBuilderAst.OnConflict),
        Match.when(
          'update',
          () => ({ targets, action: { _tag: 'update', update: updateValues! } }) satisfies QueryBuilderAst.OnConflict,
        ),
        Match.exhaustive,
      )

      return makeQueryBuilder(tableDef, {
        ...ast,
        onConflict,
      }) as any
    },

    returning: (...columns) => {
      assertWriteQueryBuilderAst(ast)

      return makeQueryBuilder(tableDef, {
        ...ast,
        returning: columns,
        resultSchema: tableDef.rowSchema.pipe(Schema.pick(...columns), Schema.Array),
      }) as any
    },

    update: (values) => {
      const filteredValues = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

      return makeQueryBuilder(tableDef, {
        _tag: 'UpdateQuery',
        tableDef,
        values: filteredValues,
        where: [],
        returning: undefined,
        resultSchema: Schema.Void,
      }) as any
    },

    delete: () => {
      return makeQueryBuilder(tableDef, {
        _tag: 'DeleteQuery',
        tableDef,
        where: [],
        returning: undefined,
        resultSchema: Schema.Void,
      }) as any
    },
  } satisfies QueryBuilder.ApiFull<TResult, TTableDef, never>

  return {
    [QueryBuilderTypeId]: QueryBuilderTypeId,
    [QueryBuilderAstSymbol]: ast,
    ['ResultType']: 'only-for-type-inference' as TResult,
    asSql: () => astToSql(ast),
    toString: () => {
      try {
        return astToSql(ast).query
      } catch (cause) {
        console.debug(`QueryBuilder.toString(): Error converting query builder to string`, cause, ast)
        return `Error converting query builder to string`
      }
    },
    ...api,
  } satisfies QueryBuilder<TResult, TTableDef>
}

const emptyAst = (tableDef: TableDefBase): QueryBuilderAst.SelectQuery => ({
  _tag: 'SelectQuery',
  columns: [],
  pickFirst: false,
  select: { columns: [] },
  orderBy: [],
  offset: Option.none(),
  limit: Option.none(),
  tableDef,
  where: [],
  resultSchemaSingle: tableDef.rowSchema,
})

// Helper functions
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function assertSelectQueryBuilderAst(ast: QueryBuilderAst): asserts ast is QueryBuilderAst.SelectQuery {
  if (ast._tag !== 'SelectQuery') {
    return shouldNeverHappen('Expected SelectQuery but got ' + ast._tag)
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function assertInsertQueryBuilderAst(ast: QueryBuilderAst): asserts ast is QueryBuilderAst.InsertQuery {
  if (ast._tag !== 'InsertQuery') {
    return shouldNeverHappen('Expected InsertQuery but got ' + ast._tag)
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function assertWriteQueryBuilderAst(ast: QueryBuilderAst): asserts ast is QueryBuilderAst.WriteQuery {
  if (ast._tag !== 'InsertQuery' && ast._tag !== 'UpdateQuery' && ast._tag !== 'DeleteQuery') {
    return shouldNeverHappen('Expected WriteQuery but got ' + ast._tag)
  }
}

const isRowQuery = (ast: QueryBuilderAst): ast is QueryBuilderAst.RowQuery => ast._tag === 'RowQuery'

export const invalidQueryBuilder = (msg?: string) => {
  return shouldNeverHappen('Invalid query builder' + (msg ? `: ${msg}` : ''))
}

export const getResultSchema = (qb: QueryBuilder<any, any, any>): Schema.Schema<any> => {
  const queryAst = qb[QueryBuilderAstSymbol]
  switch (queryAst._tag) {
    case 'SelectQuery': {
      const arraySchema = Schema.Array(queryAst.resultSchemaSingle)
      if (queryAst.pickFirst === false) {
        return arraySchema
      } else if (queryAst.pickFirst === 'throws') {
        // Will throw if the array is empty
        return arraySchema.pipe(Schema.headOrElse())
      } else {
        const fallbackValue = queryAst.pickFirst.fallback()
        return Schema.Union(arraySchema, Schema.Tuple(Schema.Literal(fallbackValue))).pipe(
          Schema.headOrElse(() => fallbackValue),
        )
      }
    }
    case 'CountQuery': {
      return Schema.Struct({ count: Schema.Number }).pipe(Schema.pluck('count'), Schema.Array, Schema.headOrElse())
    }
    case 'InsertQuery':
    case 'UpdateQuery':
    case 'DeleteQuery': {
      // For write operations with RETURNING clause, we need to return the appropriate schema
      if (queryAst.returning && queryAst.returning.length > 0) {
        // Create a schema for the returned columns
        return queryAst.tableDef.rowSchema.pipe(Schema.pick(...queryAst.returning), Schema.Array)
      }

      // For write operations without RETURNING, the result is the number of affected rows
      return Schema.Number
    }
    case 'RowQuery': {
      return queryAst.tableDef.rowSchema.pipe(
        Schema.pluck('value'),
        Schema.annotations({ title: `${queryAst.tableDef.sqliteDef.name}.value` }),
        Schema.Array,
        Schema.headOrElse(),
      )
    }
    default: {
      casesHandled(queryAst)
    }
  }
}
