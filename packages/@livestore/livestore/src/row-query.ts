import type { MainDatabase, QueryInfoCol, QueryInfoNone, QueryInfoRow } from '@livestore/common'
import { makeCuudCreateMutationDef as makeCuudCreateMutationDef_, migrateTable, sql } from '@livestore/common'
import type { DbSchema } from '@livestore/common/schema'
import { SCHEMA_META_TABLE } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Schema, TreeFormatter } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'

import type { Ref } from './reactive.js'
import type { DbContext, DbGraph, LiveQuery, LiveQueryAny } from './reactiveQueries/base-class.js'
import { computed } from './reactiveQueries/js.js'
import { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import type { RefreshReason, Store } from './store.js'
import type { GetValForKey } from './utils/util.js'

export type RowQueryOptions = {
  otelContext?: otel.Context
  skipInsertDefaultRow?: boolean
  dbGraph?: DbGraph
  /**
   * TODO remove this option again once Devtools v2 has landed
   * This option is only used right now for the devtools to pass in their custom mutation function
   * to emit raw sql mutation events instead of the default behavior of using derived mutation definitions
   */
  __makeCuudCreateMutationDef?: typeof makeCuudCreateMutationDef_
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
    // While this code-path is not needed for singleton tables, it's still needed for `useRow` with non-existing rows for a given ID
    execBeforeFirstRun: makeExecBeforeFirstRun({
      otelContext: options?.otelContext,
      table,
      componentTableName,
      defaultValues,
      id,
      skipInsertDefaultRow: options?.skipInsertDefaultRow,
      __makeCuudCreateMutationDef: options?.__makeCuudCreateMutationDef,
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

const makeExecBeforeFirstRun =
  ({
    id,
    defaultValues,
    skipInsertDefaultRow,
    otelContext: otelContext_,
    table,
    componentTableName,
    __makeCuudCreateMutationDef,
  }: {
    id?: string
    defaultValues?: any
    skipInsertDefaultRow?: boolean
    otelContext?: otel.Context
    componentTableName: string
    table: DbSchema.TableDef
    __makeCuudCreateMutationDef?: typeof makeCuudCreateMutationDef_
  }) =>
  ({ store }: DbContext) => {
    const otelContext = otelContext_ ?? store.otel.queriesSpanContext

    // TODO we can remove this codepath again when Devtools v2 has landed
    if (store.tableRefs[componentTableName] === undefined) {
      const schemaHash = SqliteAst.hash(table.sqliteDef.ast)
      const res = store.mainDbWrapper.select<{ schemaHash: number }>(
        sql`SELECT schemaHash FROM ${SCHEMA_META_TABLE} WHERE tableName = '${componentTableName}'`,
      )
      if (res.length === 0 || res[0]!.schemaHash !== schemaHash) {
        const db = {
          ...store.db.mainDb,
          prepare: (query) => {
            const mainStmt = store.db.mainDb.prepare(query)
            return {
              ...mainStmt,
              execute: (bindValues) => {
                mainStmt.execute(bindValues)
                store.db.storageDb.execute(query, bindValues, undefined)
              },
            }
          },
        } satisfies MainDatabase

        migrateTable({
          db,
          tableAst: table.sqliteDef.ast,
          otelContext,
          schemaHash,
          behaviour: 'create-if-not-exists',
        })
      }

      const label = `tableRef:${componentTableName}`

      // TODO find a better implementation for this
      const existingTableRefFromGraph = Array.from(store.graph.atoms.values()).find(
        (_) => _._tag === 'ref' && _.label === label,
      ) as Ref<null, DbContext, RefreshReason> | undefined

      store.tableRefs[componentTableName] = existingTableRefFromGraph ?? store.makeTableRef(componentTableName)
    }

    if (skipInsertDefaultRow !== true && table.options.isSingleton === false) {
      insertRowWithDefaultValuesOrIgnore({
        store,
        id: id!,
        table,
        otelContext,
        explicitDefaultValues: defaultValues,
        __makeCuudCreateMutationDef,
      })
    }
  }

const insertRowWithDefaultValuesOrIgnore = ({
  store,
  id,
  table,
  otelContext,
  explicitDefaultValues,
  __makeCuudCreateMutationDef: makeCuudCreateMutationDef = makeCuudCreateMutationDef_,
}: {
  store: Store
  id: string
  table: DbSchema.TableDef
  otelContext: otel.Context
  explicitDefaultValues: Partial<RowResult<DbSchema.TableDef>> | undefined
  __makeCuudCreateMutationDef?: typeof makeCuudCreateMutationDef_
}) => {
  const rowExists = store.mainDbWrapper.select(`select 1 from ${table.sqliteDef.name} where id = '${id}'`).length === 1
  if (rowExists) return

  const mutationDef = makeCuudCreateMutationDef(table)
  store.mutateWithoutRefresh(mutationDef({ id, explicitDefaultValues }), otelContext)
}
