import type { QueryInfoCol, QueryInfoNone, QueryInfoRow } from '@livestore/common'
import { SessionIdSymbol, sql } from '@livestore/common'
import { DbSchema } from '@livestore/common/schema'
import type { SqliteDsl } from '@livestore/db-schema'
import type { GetValForKey } from '@livestore/utils'
import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type {
  GetAtomResult,
  LiveQuery,
  LiveQueryAny,
  QueryContext,
  ReactivityGraph,
} from './reactiveQueries/base-class.js'
import { computed } from './reactiveQueries/js.js'
import { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import type { Store } from './store.js'

export type RowQueryOptions<TTableDef extends DbSchema.TableDef, TResult = RowResult<TTableDef>> = {
  otelContext?: otel.Context
  skipInsertDefaultRow?: boolean
  reactivityGraph?: ReactivityGraph
  map?: (result: RowResult<TTableDef>) => TResult
  label?: string
}

export type RowQueryOptionsDefaulValues<TTableDef extends DbSchema.TableDef> = {
  defaultValues?: Partial<RowResult<TTableDef>>
}

export type MakeRowQuery = {
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      boolean,
      DbSchema.TableOptions & { isSingleton: true }
    >,
    TResult = RowResult<TTableDef>,
  >(
    table: TTableDef,
    options?: RowQueryOptions<TTableDef, TResult>,
  ): LiveQuery<RowResult<TTableDef>, QueryInfoRow<TTableDef>>
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      boolean,
      DbSchema.TableOptions & { isSingleton: false }
    >,
    TResult = RowResult<TTableDef>,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string | SessionIdSymbol,
    options?: RowQueryOptions<TTableDef, TResult> & RowQueryOptionsDefaulValues<TTableDef>,
  ): LiveQuery<TResult, QueryInfoRow<TTableDef>>
}

// TODO also allow other where clauses and multiple rows
export const rowQuery: MakeRowQuery = <TTableDef extends DbSchema.TableDef>(
  table: TTableDef,
  idOrOptions?: string | SessionIdSymbol | RowQueryOptions<TTableDef, any>,
  options_?: RowQueryOptions<TTableDef, any> & RowQueryOptionsDefaulValues<TTableDef>,
) => {
  const id = typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? idOrOptions : undefined
  const options = typeof idOrOptions === 'string' || idOrOptions === SessionIdSymbol ? options_ : idOrOptions
  const defaultValues: Partial<RowResult<TTableDef>> | undefined = (options as any)?.defaultValues ?? {}

  // Validate query args
  if (table.options.isSingleton === true && id !== undefined && id !== SessionIdSymbol) {
    shouldNeverHappen(`Cannot query state table ${table.sqliteDef.name} with id "${id}" as it is a singleton`)
  } else if (table.options.isSingleton !== true && id === undefined) {
    shouldNeverHappen(`Cannot query state table ${table.sqliteDef.name} without id`)
  }

  const tableSchema = table.sqliteDef
  const tableName = tableSchema.name

  const makeQueryString = (id: string | undefined) =>
    sql`select * from ${tableName} ${id === undefined ? '' : `where id = '${id}'`} limit 1`

  const genQueryString =
    id === SessionIdSymbol
      ? (_: GetAtomResult, ctx: QueryContext) => makeQueryString(ctx.store.sessionId)
      : makeQueryString(id)

  const rowSchema = table.isSingleColumn === true ? table.schema.pipe(Schema.pluck('value' as any)) : table.schema

  return new LiveStoreSQLQuery({
    label:
      options?.label ??
      `rowQuery:query:${tableSchema.name}${id === undefined ? '' : id === SessionIdSymbol ? `:sessionId` : `:${id}`}`,
    genQueryString,
    queriedTables: new Set([tableName]),
    reactivityGraph: options?.reactivityGraph,
    // While this code-path is not needed for singleton tables, it's still needed for `useRow` with non-existing rows for a given ID
    execBeforeFirstRun: makeExecBeforeFirstRun({
      otelContext: options?.otelContext,
      table,
      defaultValues,
      id,
      skipInsertDefaultRow: options?.skipInsertDefaultRow,
    }),
    schema: rowSchema.pipe(Schema.Array, Schema.headOrElse()),
    map: options?.map,
    queryInfo: {
      _tag: 'Row',
      table,
      id: id === SessionIdSymbol ? 'sessionId' : (id ?? 'singleton'),
    },
  })
}

export type RowResult<TTableDef extends DbSchema.TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>, 'value'>
  : SqliteDsl.FromColumns.RowDecoded<TTableDef['sqliteDef']['columns']>

export type RowResultEncoded<TTableDef extends DbSchema.TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.RowEncoded<TTableDef['sqliteDef']['columns']>, 'value'>
  : SqliteDsl.FromColumns.RowEncoded<TTableDef['sqliteDef']['columns']>

export const deriveColQuery: {
  <TQuery extends LiveQuery<any, QueryInfoNone>, TCol extends keyof TQuery['__result!'] & string>(
    query$: TQuery,
    colName: TCol,
  ): LiveQuery<TQuery['__result!'][TCol], QueryInfoNone>
  <TQuery extends LiveQuery<any, QueryInfoRow<any>>, TCol extends keyof TQuery['__result!'] & string>(
    query$: TQuery,
    colName: TCol,
  ): LiveQuery<TQuery['__result!'][TCol], QueryInfoCol<TQuery['queryInfo']['table'], TCol>>
} = (query$: LiveQueryAny, colName: string) => {
  return computed((get) => get(query$)[colName], {
    label: `deriveColQuery:${query$.label}:${colName}`,
    queryInfo:
      query$.queryInfo._tag === 'Row'
        ? { _tag: 'Col', table: query$.queryInfo.table, column: colName, id: query$.queryInfo.id }
        : undefined,
  }) as any
}

const makeExecBeforeFirstRun =
  ({
    id,
    defaultValues,
    skipInsertDefaultRow,
    otelContext: otelContext_,
    table,
  }: {
    id?: string | SessionIdSymbol
    defaultValues?: any
    skipInsertDefaultRow?: boolean
    otelContext?: otel.Context
    table: DbSchema.TableDef
  }) =>
  ({ store }: QueryContext) => {
    const otelContext = otelContext_ ?? store.otel.queriesSpanContext

    if (skipInsertDefaultRow !== true && table.options.isSingleton === false) {
      insertRowWithDefaultValuesOrIgnore({
        store,
        id: id!,
        table,
        otelContext,
        explicitDefaultValues: defaultValues,
      })
    }
  }

const insertRowWithDefaultValuesOrIgnore = ({
  store,
  id,
  table,
  otelContext,
  explicitDefaultValues,
}: {
  store: Store
  id: string | SessionIdSymbol
  table: DbSchema.TableDef
  otelContext: otel.Context
  explicitDefaultValues: Partial<RowResult<DbSchema.TableDef>> | undefined
}) => {
  const idStr = id === SessionIdSymbol ? store.sessionId : id
  const rowExists =
    store.syncDbWrapper.select(`select 1 from ${table.sqliteDef.name} where id = '${idStr}'`).length === 1

  if (rowExists) return

  // const mutationDef = deriveCreateMutationDef(table)
  if (DbSchema.tableHasDerivedMutations(table) === false) {
    return shouldNeverHappen(
      `Cannot insert row for table "${table.sqliteDef.name}" which does not have 'deriveMutations: true' set`,
    )
  }
  // NOTE It's important that we only mutate and don't refresh here, as this function is called during a render
  store.mutateWithoutRefresh(table.insert({ id, ...explicitDefaultValues }), {
    otelContext,
    coordinatorMode: 'default',
  })
}
