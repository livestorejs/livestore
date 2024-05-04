import type { QueryInfoCol, QueryInfoNone, QueryInfoRow } from '@livestore/common'
import { migrateTable, sql } from '@livestore/common'
import { DbSchema, SCHEMA_META_TABLE } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Schema, TreeFormatter } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'

import type { Ref } from './reactive.js'
import type { DbContext, DbGraph, LiveQuery, LiveQueryAny } from './reactiveQueries/base-class.js'
import { computed } from './reactiveQueries/js.js'
// import type { LiveStoreJSQuery } from './reactiveQueries/js.js'
import { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import type { RefreshReason, Store } from './store.js'
import type { GetValForKey } from './utils/util.js'

export type RowQueryOptions = {
  otelContext?: otel.Context
  skipInsertDefaultRow?: boolean
  dbGraph?: DbGraph
}

export type RowQueryOptionsDefaulValues<TTableDef extends DbSchema.TableDef> = {
  defaultValues: Partial<RowResult<TTableDef>>
}

export type MakeRowQuery = {
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      boolean,
      DbSchema.TableOptions & { isSingleton: true }
    >,
  >(
    table: TTableDef,
    options?: RowQueryOptions,
  ): LiveQuery<RowResult<TTableDef>, QueryInfoRow<TTableDef>>
  <
    TTableDef extends DbSchema.TableDef<
      DbSchema.DefaultSqliteTableDef,
      boolean,
      DbSchema.TableOptions & { isSingleton: false }
    >,
  >(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string,
    options?: RowQueryOptions & RowQueryOptionsDefaulValues<TTableDef>,
  ): LiveQuery<RowResult<TTableDef>, QueryInfoRow<TTableDef>>
}

// TODO also allow other where clauses and multiple rows
export const rowQuery: MakeRowQuery = <TTableDef extends DbSchema.TableDef>(
  table: TTableDef,
  idOrOptions?: string | RowQueryOptions,
  options_?: RowQueryOptions & RowQueryOptionsDefaulValues<TTableDef>,
) => {
  const id = typeof idOrOptions === 'string' ? idOrOptions : undefined
  const options = typeof idOrOptions === 'string' ? options_ : idOrOptions
  const defaultValues: Partial<RowResult<TTableDef>> | undefined = (options as any)?.defaultValues ?? {}

  // Validate query args
  if (table.options.isSingleton === true && id !== undefined) {
    shouldNeverHappen(`Cannot query state table ${table.sqliteDef.name} with id "${id}" as it is a singleton`)
  } else if (table.options.isSingleton !== true && id === undefined) {
    shouldNeverHappen(`Cannot query state table ${table.sqliteDef.name} without id`)
  }

  const stateSchema = table.sqliteDef
  const componentTableName = stateSchema.name

  const whereClause = id === undefined ? '' : `where id = '${id}'`
  const queryStr = sql`select * from ${componentTableName} ${whereClause} limit 1`

  return new LiveStoreSQLQuery({
    label: `rowQuery:query:${stateSchema.name}${id === undefined ? '' : `:${id}`}`,
    genQueryString: queryStr,
    queriedTables: new Set([componentTableName]),
    dbGraph: options?.dbGraph,
    // TODO remove this once the LiveStore Devtools are no longer relying on it
    // as the defaults rows are now already being inserted during store initialization
    // and the tables need to be registered during initialization
    execBeforeFirstRun: makeExecBeforeFirstRun({
      otelContext: options?.otelContext,
      table,
      componentTableName,
      defaultValues,
      id,
      skipInsertDefaultRow: options?.skipInsertDefaultRow,
    }),
    map: (results): RowResult<TTableDef> => {
      if (results.length === 0) return shouldNeverHappen(`No results for query ${queryStr}`)

      const componentStateEffectSchema = SqliteDsl.structSchemaForTable(stateSchema)
      const parseResult = Schema.decodeEither(componentStateEffectSchema)(results[0]!)

      if (parseResult._tag === 'Left') {
        console.error('decode error', TreeFormatter.formatError(parseResult.left), 'results', results)
        return shouldNeverHappen(`Error decoding query result for ${queryStr}`)
      }

      return table.isSingleColumn === true ? parseResult.right.value : parseResult.right
    },
    queryInfo: { _tag: 'Row', table, id: id ?? 'singleton' },
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

const insertRowWithDefaultValuesOrIgnore = ({
  store,
  id,
  table,
  otelContext,
  defaultValues: explicitDefaultValues,
}: {
  store: Store
  id: string
  table: DbSchema.TableDef
  otelContext: otel.Context
  defaultValues: Partial<RowResult<DbSchema.TableDef>> | undefined
}) => {
  const defaultValues = DbSchema.getDefaultValuesEncoded(table, explicitDefaultValues)

  const defaultColumnNames = [...Object.keys(defaultValues), 'id']
  const columnValues = defaultColumnNames.map((name) => `$${name}`).join(', ')

  const tableName = table.sqliteDef.name
  const insertQuery = sql`insert into ${tableName} (${defaultColumnNames.join(
    ', ',
  )}) select ${columnValues} where not exists(select 1 from ${tableName} where id = '${id}')`

  store.execute(insertQuery, { ...defaultValues, id }, new Set([tableName]), otelContext)
}

const makeExecBeforeFirstRun =
  ({
    id,
    defaultValues,
    skipInsertDefaultRow,
    otelContext: otelContext_,
    table,
    componentTableName,
  }: {
    id?: string
    defaultValues?: any
    skipInsertDefaultRow?: boolean
    otelContext?: otel.Context
    componentTableName: string
    table: DbSchema.TableDef
  }) =>
  ({ store }: DbContext) => {
    const otelContext = otelContext_ ?? store.otel.queriesSpanContext

    // TODO find a better solution for this
    if (store.tableRefs[componentTableName] === undefined) {
      const schemaHash = SqliteAst.hash(table.sqliteDef.ast)
      const res = store.mainDbWrapper.select<{ schemaHash: number }>(
        sql`SELECT schemaHash FROM ${SCHEMA_META_TABLE} WHERE tableName = '${componentTableName}'`,
      )
      if (res.length === 0 || res[0]!.schemaHash !== schemaHash) {
        migrateTable({
          db: store.db.mainDb,
          tableAst: table.sqliteDef.ast,
          otelContext,
          schemaHash,
        })
      }

      const label = `tableRef:${componentTableName}`

      // TODO find a better implementation for this
      const existingTableRefFromGraph = Array.from(store.graph.atoms.values()).find(
        (_) => _._tag === 'ref' && _.label === label,
      ) as Ref<null, DbContext, RefreshReason> | undefined

      store.tableRefs[componentTableName] = existingTableRefFromGraph ?? store.makeTableRef(componentTableName)
    }

    if (skipInsertDefaultRow !== true) {
      insertRowWithDefaultValuesOrIgnore({
        store,
        id: id ?? 'singleton',
        table,
        otelContext,
        defaultValues,
      })
    }
  }
