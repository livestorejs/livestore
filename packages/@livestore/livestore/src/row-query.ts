import { shouldNeverHappen } from '@livestore/utils'
import { pipe, ReadonlyRecord, Schema, TreeFormatter } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'

import type { InMemoryDatabase } from './inMemoryDatabase.js'
import { migrateTable } from './migrations.js'
import type { Ref } from './reactive.js'
import type { DbContext, DbGraph } from './reactiveQueries/base-class.js'
// import type { LiveStoreJSQuery } from './reactiveQueries/js.js'
import { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import { SCHEMA_META_TABLE } from './schema/index.js'
import {
  type DefaultSqliteTableDef,
  getDefaultValuesEncoded,
  type TableDef,
  type TableOptions,
} from './schema/table-def.js'
import type { RefreshReason } from './store.js'
import type { GetValForKey } from './utils/util.js'
import { prepareBindValues, sql } from './utils/util.js'

export type RowQueryOptions = {
  otelContext?: otel.Context
  skipInsertDefaultRow?: boolean
  dbGraph?: DbGraph
}

export type RowQueryOptionsDefaulValues<TTableDef extends TableDef> = {
  defaultValues: Partial<RowResult<TTableDef>>
}

export type MakeRowQuery = {
  <TTableDef extends TableDef<DefaultSqliteTableDef, boolean, TableOptions & { isSingleton: true }>>(
    table: TTableDef,
    options?: RowQueryOptions,
  ): LiveStoreSQLQuery<RowResult<TTableDef>>
  <TTableDef extends TableDef<DefaultSqliteTableDef, boolean, TableOptions & { isSingleton: false }>>(
    table: TTableDef,
    // TODO adjust so it works with arbitrary primary keys or unique constraints
    id: string,
    options?: RowQueryOptions & RowQueryOptionsDefaulValues<TTableDef>,
  ): LiveStoreSQLQuery<RowResult<TTableDef>>
}

// TODO also allow other where clauses and multiple rows
export const rowQuery: MakeRowQuery = <TTableDef extends TableDef>(
  table: TTableDef,
  idOrOptions?: string | RowQueryOptions,
  options_?: RowQueryOptions & RowQueryOptionsDefaulValues<TTableDef>,
) => {
  const id = typeof idOrOptions === 'string' ? idOrOptions : undefined
  const options = typeof idOrOptions === 'string' ? options_ : idOrOptions
  const defaultValues: Partial<RowResult<TTableDef>> | undefined = (options as any).defaultValues ?? {}

  // Validate query args
  if (table.options.isSingleton === true && id !== undefined) {
    shouldNeverHappen(`Cannot query state table ${table.schema.name} with id "${id}" as it is a singleton`)
  } else if (table.options.isSingleton !== true && id === undefined) {
    shouldNeverHappen(`Cannot query state table ${table.schema.name} without id`)
  }

  const stateSchema = table.schema
  const componentTableName = stateSchema.name

  const whereClause = id === undefined ? '' : `where id = '${id}'`
  const queryStr = sql`select * from ${componentTableName} ${whereClause} limit 1`

  return new LiveStoreSQLQuery({
    label: `rowQuery:query:${stateSchema.name}${id === undefined ? '' : `:${id}`}`,
    genQueryString: queryStr,
    queriedTables: new Set([componentTableName]),
    dbGraph: options?.dbGraph,
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
      const parseResult = Schema.parseEither(componentStateEffectSchema)(results[0]!)

      if (parseResult._tag === 'Left') {
        console.error('decode error', TreeFormatter.formatError(parseResult.left), 'results', results)
        return shouldNeverHappen(`Error decoding query result for ${queryStr}`)
      }

      return table.isSingleColumn === true ? parseResult.right.value : parseResult.right
    },
  })
}

export type RowResult<TTableDef extends TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.RowDecoded<TTableDef['schema']['columns']>, 'value'>
  : SqliteDsl.FromColumns.RowDecoded<TTableDef['schema']['columns']>

export type RowResultEncoded<TTableDef extends TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.RowEncoded<TTableDef['schema']['columns']>, 'value'>
  : SqliteDsl.FromColumns.RowEncoded<TTableDef['schema']['columns']>

const insertRowWithDefaultValuesOrIgnore = ({
  db,
  id,
  table,
  otelContext,
  defaultValues: explicitDefaultValues,
}: {
  db: InMemoryDatabase
  id: string
  table: TableDef
  otelContext: otel.Context
  defaultValues: Partial<RowResult<TableDef>> | undefined
}) => {
  const columnNames = Object.keys(table.schema.columns)
  const columnValues = columnNames.map((name) => `$${name}`).join(', ')

  const tableName = table.schema.name
  const insertQuery = sql`insert into ${tableName} (${columnNames.join(
    ', ',
  )}) select ${columnValues} where not exists(select 1 from ${tableName} where id = '${id}')`

  const defaultValues = pipe(
    getDefaultValuesEncoded(table),
    ReadonlyRecord.map((val, columnName) => explicitDefaultValues?.[columnName] ?? val),
  )

  db.execute(insertQuery, prepareBindValues({ ...defaultValues, id }, insertQuery), [tableName], { otelContext })
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
    table: TableDef
  }) =>
  ({ store }: DbContext) => {
    const otelContext = otelContext_ ?? store.otel.queriesSpanContext

    // TODO find a better solution for this
    if (store.tableRefs[componentTableName] === undefined) {
      const schemaHash = SqliteAst.hash(table.schema.ast)
      const res = store.inMemoryDB.select<{ schemaHash: number }>(
        sql`SELECT schemaHash FROM ${SCHEMA_META_TABLE} WHERE tableName = '${componentTableName}'`,
      )
      if (res.length === 0 || res[0]!.schemaHash !== schemaHash) {
        migrateTable({
          db: store._proxyDb,
          tableAst: table.schema.ast,
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
      // TODO find a way to only do this if necessary
      insertRowWithDefaultValuesOrIgnore({
        db: store._proxyDb,
        id: id ?? 'singleton',
        table,
        otelContext,
        defaultValues,
      })
    }
  }
