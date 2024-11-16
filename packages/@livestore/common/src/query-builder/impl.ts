import { Option, Schema } from '@livestore/utils/effect'

import { type DefaultSqliteTableDef, SqliteDsl } from '../schema/table-def.js'
import type { QueryBuilder, QueryBuilderAst } from './api.js'
import { QueryBuilderAstSymbol, QueryBuilderSymbol } from './api.js'

export const makeQueryBuilder = <TResult, TSqliteDef extends DefaultSqliteTableDef>(
  tableDef: TSqliteDef,
  ast: QueryBuilderAst = emptyAst(tableDef),
): QueryBuilder<TResult, TSqliteDef> => {
  const api = {
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    select() {
      // eslint-disable-next-line prefer-rest-params
      const params = [...arguments]
      if (ast._tag === 'CountQuery') return invalidQueryBuilder()

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
      })
    },
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    where() {
      if (arguments.length === 1) {
        // eslint-disable-next-line prefer-rest-params
        const params = arguments[0]
        const newOps = Object.entries(params)
          .filter(([, value]) => value !== undefined)
          .map(([col, value]) => ({ col, op: '=', value }) satisfies QueryBuilderAst.Where)

        return makeQueryBuilder(tableDef, {
          ...ast,
          where: [...ast.where, ...newOps],
        })
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
      if (ast._tag === 'CountQuery' || arguments.length === 0 || arguments.length > 2) return invalidQueryBuilder()

      if (arguments.length === 1) {
        // eslint-disable-next-line prefer-rest-params
        const params = arguments[0] as QueryBuilder.OrderByParams<TSqliteDef>
        return makeQueryBuilder(tableDef, {
          ...ast,
          orderBy: [...ast.orderBy, ...params],
        })
      }

      // eslint-disable-next-line prefer-rest-params
      const [col, direction] = arguments as any as [keyof TSqliteDef['columns'] & string, 'asc' | 'desc']

      return makeQueryBuilder(tableDef, {
        ...ast,
        orderBy: [...ast.orderBy, { col, direction }],
      })
    },
    limit: (limit) => {
      if (ast._tag === 'CountQuery') return invalidQueryBuilder()

      return makeQueryBuilder(tableDef, { ...ast, limit: Option.some(limit) })
    },
    offset: (offset) => {
      if (ast._tag === 'CountQuery') return invalidQueryBuilder()

      return makeQueryBuilder(tableDef, { ...ast, offset: Option.some(offset) })
    },
    count: () => {
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
    first: (fallback) => {
      if (ast._tag === 'CountQuery') return invalidQueryBuilder()

      return makeQueryBuilder(tableDef, {
        ...ast,
        pickFirst: fallback ? { fallback } : false,
      })
    },
  } satisfies QueryBuilder.ApiFull<TResult, TSqliteDef, never>

  return {
    [QueryBuilderSymbol]: QueryBuilderSymbol,
    [QueryBuilderAstSymbol]: ast,
    asSql: () => astToSql(ast),
    toString: () => astToSql(ast).query,
    ...api,
  } satisfies Omit<QueryBuilder<TResult, TSqliteDef>, 'pluck'>
}

const emptyAst = (tableDef: DefaultSqliteTableDef) =>
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
    resultSchemaSingle: SqliteDsl.structSchemaForTable(tableDef),
  }) satisfies QueryBuilderAst

// const mutateAst = (ast: QueryBuilderAst, mutator: (ast: QueryBuilderAst) => void) => {
//   const newAst = structuredClone(ast)
//   mutator(newAst)
//   return newAst
// }

const astToSql = (ast: QueryBuilderAst) => {
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
              bindValues.push(value)
              return `${col} ${op} ?`
            }
          })
          .join(' AND ')}`
      : ''

  if (ast._tag === 'CountQuery') {
    const selectFromStmt = `COUNT(*) as count FROM '${ast.tableDef.name}'`
    const query = [selectFromStmt, whereStmt].filter((_) => _.length > 0).join(' ')
    return { query, bindValues }
  }
  const columnsStmt = ast.select.columns.length === 0 ? '*' : ast.select.columns.join(', ')
  const selectStmt = `SELECT ${columnsStmt}`
  const fromStmt = `FROM '${ast.tableDef.name}'`

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

export const invalidQueryBuilder = () => {
  throw new Error('Invalid query builder')
}
