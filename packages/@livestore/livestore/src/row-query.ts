import type { InMemoryDatabase, QueryInfoCol, QueryInfoNone, QueryInfoRow } from '@livestore/common'
import { migrateTable, sql } from '@livestore/common'
import { DbSchema, SCHEMA_META_TABLE } from '@livestore/common/schema'
import type { GetValForKey } from '@livestore/utils'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Schema, TreeFormatter } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { SqliteDsl } from 'effect-db-schema'
import { SqliteAst } from 'effect-db-schema'

import type { Ref } from './reactive.js'
import type { LiveQuery, LiveQueryAny, QueryContext, ReactivityGraph } from './reactiveQueries/base-class.js'
import { computed } from './reactiveQueries/js.js'
import { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import type { RefreshReason, Store } from './store.js'

export type RowQueryOptions = {
  otelContext?: otel.Context
  skipInsertDefaultRow?: boolean
  reactivityGraph?: ReactivityGraph
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

  const tableSchema = table.sqliteDef
  const tableName = tableSchema.name

  const whereClause = id === undefined ? '' : `where id = '${id}'`
  const queryStr = sql`select * from ${tableName} ${whereClause} limit 1`

  return new LiveStoreSQLQuery({
    label: `rowQuery:query:${tableSchema.name}${id === undefined ? '' : `:${id}`}`,
    genQueryString: queryStr,
    queriedTables: new Set([tableName]),
    reactivityGraph: options?.reactivityGraph,
    // While this code-path is not needed for singleton tables, it's still needed for `useRow` with non-existing rows for a given ID
    execBeforeFirstRun: makeExecBeforeFirstRun({
      otelContext: options?.otelContext,
      table,
      tableName,
      defaultValues,
      id,
      skipInsertDefaultRow: options?.skipInsertDefaultRow,
    }),
    map: (results): RowResult<TTableDef> => {
      if (results.length === 0) return shouldNeverHappen(`No results for query ${queryStr}`)

      const parseResult = Schema.decodeEither(table.schema)(results[0]!)

      if (parseResult._tag === 'Left') {
        console.error('decode error', TreeFormatter.formatErrorSync(parseResult.left), 'results', results)
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
    tableName,
  }: {
    id?: string
    defaultValues?: any
    skipInsertDefaultRow?: boolean
    otelContext?: otel.Context
    tableName: string
    table: DbSchema.TableDef
  }) =>
  ({ store }: QueryContext) => {
    const otelContext = otelContext_ ?? store.otel.queriesSpanContext

    // TODO we can remove this codepath again when Devtools v2 has landed
    if (store.tableRefs[tableName] === undefined) {
      const schemaHash = SqliteAst.hash(table.sqliteDef.ast)
      const res = store.mainDbWrapper.select<{ schemaHash: number }>(
        sql`SELECT schemaHash FROM ${SCHEMA_META_TABLE} WHERE tableName = '${tableName}'`,
      )
      if (res.length === 0 || res[0]!.schemaHash !== schemaHash) {
        const db = {
          ...store.adapter.mainDb,
          prepare: (query) => {
            const mainStmt = store.adapter.mainDb.prepare(query)
            return {
              ...mainStmt,
              execute: (bindValues) => {
                const getRowsChanged = mainStmt.execute(bindValues)
                store.adapter.coordinator.execute(query, bindValues).pipe(Effect.tapCauseLogPretty, Effect.runFork)
                return getRowsChanged
              },
            }
          },
        } satisfies InMemoryDatabase

        migrateTable({
          db,
          tableAst: table.sqliteDef.ast,
          otelContext,
          schemaHash,
          behaviour: 'create-if-not-exists',
        })
      }

      const label = `tableRef:${tableName}`

      // TODO find a better implementation for this
      const existingTableRefFromGraph = Array.from(store.reactivityGraph.atoms.values()).find(
        (_) => _._tag === 'ref' && _.label === label,
      ) as Ref<null, QueryContext, RefreshReason> | undefined

      store.tableRefs[tableName] = existingTableRefFromGraph ?? store.makeTableRef(tableName)
    }

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
  id: string
  table: DbSchema.TableDef
  otelContext: otel.Context
  explicitDefaultValues: Partial<RowResult<DbSchema.TableDef>> | undefined
}) => {
  const rowExists = store.mainDbWrapper.select(`select 1 from ${table.sqliteDef.name} where id = '${id}'`).length === 1
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
