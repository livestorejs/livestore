import { Option, Predicate, Schema } from '@livestore/utils/effect'

import type { QueryInfo } from '../query-info.js'
import type { DbSchema } from '../schema/index.js'
import type { QueryBuilder, QueryBuilderAst } from './api.js'
import { QueryBuilderAstSymbol, TypeId } from './api.js'

export const makeQueryBuilder = <TResult, TTableDef extends DbSchema.TableDefBase>(
  tableDef: TTableDef,
  ast: QueryBuilderAst = emptyAst(tableDef),
): QueryBuilder<TResult, TTableDef, never, QueryInfo.None> => {
  const api = {
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    select() {
      assertQueryBuilderAst(ast)

      // eslint-disable-next-line prefer-rest-params
      const params = [...arguments]

      if (params.length === 2 && typeof params[0] === 'string' && typeof params[1] === 'object') {
        const [col, options] = params as any as [string, { pluck: boolean }]
        return makeQueryBuilder(tableDef, {
          ...ast,
          resultSchemaSingle: options.pluck ? ast.resultSchemaSingle.pipe(Schema.pluck(col)) : ast.resultSchemaSingle,
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
    where() {
      if (isRowQuery(ast)) return invalidQueryBuilder()

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

        return makeQueryBuilder(tableDef, {
          ...ast,
          where: [...ast.where, ...newOps],
        }) as any
      }

      // eslint-disable-next-line prefer-rest-params
      const [col, opOrValue, valueOrUndefined] = arguments
      const op = valueOrUndefined === undefined ? '=' : opOrValue
      const value = valueOrUndefined === undefined ? opOrValue : valueOrUndefined
      return makeQueryBuilder(tableDef, {
        ...ast,
        where: [...ast.where, { col, op, value }],
      })
    },
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    orderBy() {
      assertQueryBuilderAst(ast)

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
      assertQueryBuilderAst(ast)

      return makeQueryBuilder(tableDef, { ...ast, limit: Option.some(limit) })
    },
    offset: (offset) => {
      assertQueryBuilderAst(ast)

      return makeQueryBuilder(tableDef, { ...ast, offset: Option.some(offset) })
    },
    count: () => {
      if (isRowQuery(ast)) return invalidQueryBuilder()

      return makeQueryBuilder(tableDef, {
        ...ast,
        resultSchema: Schema.Struct({ count: Schema.Number }).pipe(
          Schema.pluck('count'),
          Schema.Array,
          Schema.headOrElse(),
        ),
        _tag: 'CountQuery',
      })
    },
    first: (options) => {
      assertQueryBuilderAst(ast)

      if (ast.limit._tag === 'Some') return invalidQueryBuilder(`.first() can't be called after .limit()`)

      return makeQueryBuilder(tableDef, {
        ...ast,
        limit: Option.some(1),
        pickFirst: options?.fallback ? { fallback: options.fallback } : false,
      })
    },
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    row() {
      // eslint-disable-next-line prefer-rest-params
      const params = [...arguments]

      let id: string

      if (tableDef.options.isSingleton) {
        id = tableDef.sqliteDef.columns.id!.default.pipe(Option.getOrThrow)
      } else {
        id = params[0] as string
        if (id === undefined) {
          invalidQueryBuilder(`Id missing for row query on non-singleton table ${tableDef.sqliteDef.name}`)
        }
      }

      // TODO validate all required columns are present and values are matching the schema
      const insertValues: Record<string, unknown> = params[1]?.insertValues ?? {}

      return makeQueryBuilder(tableDef, {
        _tag: 'RowQuery',
        id,
        tableDef,
        insertValues,
      }) as any
    },
  } satisfies QueryBuilder.ApiFull<TResult, TTableDef, never, QueryInfo.None>

  return {
    [TypeId]: TypeId,
    [QueryBuilderAstSymbol]: ast,
    asSql: () => astToSql(ast),
    toString: () => astToSql(ast).query,
    ...api,
  } satisfies QueryBuilder<TResult, TTableDef>
}

const emptyAst = (tableDef: DbSchema.TableDefBase) =>
  ({
    _tag: 'SelectQuery',
    columns: [],
    pickFirst: false,
    select: { columns: [] },
    orderBy: [],
    offset: Option.none(),
    limit: Option.none(),
    tableDef,
    where: [],
    resultSchemaSingle: tableDef.schema,
  }) satisfies QueryBuilderAst

const astToSql = (ast: QueryBuilderAst) => {
  if (isRowQuery(ast)) {
    // TODO
    return { query: `SELECT * FROM '${ast.tableDef.sqliteDef.name}' WHERE id = ?`, bindValues: [ast.id as TODO] }
  }

  const bindValues: unknown[] = []

  // TODO bind values
  const whereStmt =
    ast.where.length > 0
      ? `WHERE ${ast.where
          .map(({ col, op, value }) => {
            if (value === null) {
              if (op !== '=' && op !== '!=') {
                throw new Error(`Unsupported operator for NULL value: ${op}`)
              }
              const opStmt = op === '=' ? 'IS' : 'IS NOT'
              return `${col} ${opStmt} NULL`
            } else {
              const colDef = ast.tableDef.sqliteDef.columns[col]
              if (colDef === undefined) {
                throw new Error(`Column ${col} not found`)
              }
              const encodedValue = Schema.encodeSync(colDef.schema)(value)
              bindValues.push(encodedValue)
              return `${col} ${op} ?`
            }
          })
          .join(' AND ')}`
      : ''

  if (ast._tag === 'CountQuery') {
    const selectFromStmt = `SELECT COUNT(*) as count FROM '${ast.tableDef.sqliteDef.name}'`
    const query = [selectFromStmt, whereStmt].filter((_) => _.length > 0).join(' ')
    return { query, bindValues }
  }
  const columnsStmt = ast.select.columns.length === 0 ? '*' : ast.select.columns.join(', ')
  const selectStmt = `SELECT ${columnsStmt}`
  const fromStmt = `FROM '${ast.tableDef.sqliteDef.name}'`

  const orderByStmt =
    ast.orderBy.length > 0
      ? `ORDER BY ${ast.orderBy.map(({ col, direction }) => `${col} ${direction}`).join(', ')}`
      : ''

  const limitStmt = ast.limit._tag === 'Some' ? `LIMIT ?` : ''
  if (ast.limit._tag === 'Some') bindValues.push(ast.limit.value)

  const offsetStmt = ast.offset._tag === 'Some' ? `OFFSET ?` : ''
  if (ast.offset._tag === 'Some') bindValues.push(ast.offset.value)

  const query = [selectStmt, fromStmt, whereStmt, orderByStmt, offsetStmt, limitStmt]
    .map((_) => _.trim())
    .filter((_) => _.length > 0)
    .join(' ')

  // TODO bind values
  return { query, bindValues }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function assertQueryBuilderAst(ast: QueryBuilderAst): asserts ast is QueryBuilderAst.SelectQuery {
  if (ast._tag !== 'SelectQuery') {
    throw new Error('Expected SelectQuery but got ' + ast._tag)
  }
}

const isRowQuery = (ast: QueryBuilderAst): ast is QueryBuilderAst.RowQuery => ast._tag === 'RowQuery'

export const invalidQueryBuilder = (msg?: string) => {
  throw new Error('Invalid query builder' + (msg ? `: ${msg}` : ''))
}

export const getResultSchema = (qb: QueryBuilder<any, any, any>) => {
  const queryAst = qb[QueryBuilderAstSymbol]
  if (queryAst._tag === 'SelectQuery') {
    const arraySchema = Schema.Array(queryAst.resultSchemaSingle)
    if (queryAst.pickFirst !== false) {
      return arraySchema.pipe(Schema.headOrElse(queryAst.pickFirst.fallback))
    }

    return arraySchema
  } else if (queryAst._tag === 'CountQuery') {
    return Schema.Struct({ count: Schema.Number }).pipe(Schema.pluck('count'), Schema.Array, Schema.headOrElse())
  } else {
    if (queryAst.tableDef.options.isSingleColumn) {
      return queryAst.tableDef.schema.pipe(Schema.pluck('value'), Schema.Array, Schema.headOrElse())
    } else {
      return queryAst.tableDef.schema.pipe(Schema.Array, Schema.headOrElse())
    }
  }
}
