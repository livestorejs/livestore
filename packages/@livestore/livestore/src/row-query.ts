import { shouldNeverHappen } from '@livestore/utils'
import { pipe, ReadonlyRecord, Schema, TreeFormatter } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'

import type { InMemoryDatabase } from './inMemoryDatabase.js'
import { migrateTable } from './migrations.js'
import type { LiveStoreJSQuery } from './reactiveQueries/js.js'
import { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import { SCHEMA_META_TABLE } from './schema/index.js'
import type { TableDef } from './schema/table-def.js'
import type { Store } from './store.js'
import { prepareBindValues, sql } from './utils/util.js'

export type RowQueryArgs<TTableDef extends TableDef> = TTableDef['options']['isSingleton'] extends true
  ? {
      table: TTableDef
      store: Store
      otelContext?: otel.Context
      defaultValues: Partial<RowResult<TTableDef>>
      skipInsertDefaultRow?: boolean
    }
  : {
      table: TTableDef
      store: Store
      otelContext?: otel.Context
      id: string
      defaultValues: Partial<RowResult<TTableDef>>
      skipInsertDefaultRow?: boolean
    }

// TODO also allow other where clauses and multiple rows
export const rowQuery = <TTableDef extends TableDef>(
  args: RowQueryArgs<TTableDef>,
): LiveStoreJSQuery<RowResult<TTableDef>> => {
  const { table, store, defaultValues, skipInsertDefaultRow } = args
  const otelContext = args.otelContext ?? store.otel.queriesSpanContext
  const id: string | undefined = (args as any).id

  // Validate query args
  if (table.options.isSingleton === true && id !== undefined) {
    shouldNeverHappen(`Cannot query state table ${table.schema.name} with id "${id}" as it is a singleton`)
  } else if (table.options.isSingleton !== true && id === undefined) {
    shouldNeverHappen(`Cannot query state table ${table.schema.name} without id`)
  }

  const stateSchema = table.schema
  const componentTableName = stateSchema.name

  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TTableDef['schema']['columns']>

  // TODO find a better solution for this
  if (store.tableRefs[componentTableName] === undefined) {
    const schemaHash = SqliteAst.hash(stateSchema.ast)
    const res = store.inMemoryDB.select<{ schemaHash: number }>(
      sql`SELECT schemaHash FROM ${SCHEMA_META_TABLE} WHERE tableName = '${componentTableName}'`,
    )
    if (res.length === 0 || res[0]!.schemaHash !== schemaHash) {
      migrateTable({
        db: store._proxyDb,
        tableAst: stateSchema.ast,
        otelContext,
        schemaHash,
      })
    }

    store.tableRefs[componentTableName] = store.graph.makeRef(null, {
      equal: () => false,
      label: componentTableName,
      meta: { liveStoreRefType: 'table' },
    })
  }

  if (skipInsertDefaultRow !== true) {
    // TODO find a way to only do this if necessary
    insertRowWithDefaultValuesOrIgnore({
      db: store._proxyDb,
      id: id ?? 'singleton',
      stateSchema,
      otelContext,
      defaultValues,
    })
  }

  const whereClause = id === undefined ? '' : `where id = '${id}'`
  const queryStr = sql`select * from ${componentTableName} ${whereClause} limit 1`

  return new LiveStoreSQLQuery({
    label: `localState:query:${stateSchema.name}${id === undefined ? '' : `:${id}`}`,
    genQueryString: queryStr,
    queriedTables: new Set([componentTableName]),
  }).pipe<TComponentState>((results) => {
    if (results.length === 0) return shouldNeverHappen(`No results for query ${queryStr}`)

    const componentStateEffectSchema = SqliteDsl.structSchemaForTable(stateSchema)
    const parseResult = Schema.parseEither(componentStateEffectSchema)(results[0]!)

    if (parseResult._tag === 'Left') {
      console.error('decode error', TreeFormatter.formatErrors(parseResult.left.errors), 'results', results)
      return shouldNeverHappen(`Error decoding query result for ${queryStr}`)
    }

    return table.isSingleColumn === true ? parseResult.right.value : parseResult.right
  }) as unknown as LiveStoreJSQuery<RowResult<TTableDef>>
}

type GetValForKey<T, K> = K extends keyof T ? T[K] : never

export type RowResult<TTableDef extends TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.RowDecoded<TTableDef['schema']['columns']>, 'value'>
  : SqliteDsl.FromColumns.RowDecoded<TTableDef['schema']['columns']>

export type RowResultEncoded<TTableDef extends TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.RowEncoded<TTableDef['schema']['columns']>, 'value'>
  : SqliteDsl.FromColumns.RowEncoded<TTableDef['schema']['columns']>

export type RowInsert<TTableDef extends TableDef> = TTableDef['isSingleColumn'] extends true
  ? GetValForKey<SqliteDsl.FromColumns.InsertRowDecoded<TTableDef['schema']['columns']>, 'value'>
  : SqliteDsl.FromColumns.InsertRowDecoded<TTableDef['schema']['columns']>

const insertRowWithDefaultValuesOrIgnore = ({
  db,
  id,
  stateSchema,
  otelContext,
  defaultValues: explicitDefaultValues,
}: {
  db: InMemoryDatabase
  id: string
  stateSchema: SqliteDsl.TableDefinition<string, SqliteDsl.Columns>
  otelContext: otel.Context
  defaultValues: Partial<RowResult<TableDef>> | undefined
}) => {
  const columnNames = Object.keys(stateSchema.columns)
  const columnValues = columnNames.map((name) => `$${name}`).join(', ')

  const tableName = stateSchema.name
  const insertQuery = sql`insert into ${tableName} (${columnNames.join(
    ', ',
  )}) select ${columnValues} where not exists(select 1 from ${tableName} where id = '${id}')`

  const defaultValues = pipe(
    stateSchema.columns,
    ReadonlyRecord.filter((_, key) => key !== 'id'),
    ReadonlyRecord.map((column, columnName) =>
      column.default._tag === 'None'
        ? column.nullable === true
          ? null
          : shouldNeverHappen(`Column ${columnName} has no default value and is not nullable`)
        : Schema.encodeSync(column.schema)(column.default.value),
    ),
    ReadonlyRecord.map((val, columnName) => explicitDefaultValues?.[columnName] ?? val),
  )

  void db.execute(insertQuery, prepareBindValues({ ...defaultValues, id }, insertQuery), [tableName], { otelContext })
}
