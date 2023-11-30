import type { PrettifyFlat } from '@livestore/utils'
import { shouldNeverHappen } from '@livestore/utils'
import { pipe, ReadonlyRecord, Schema, TreeFormatter } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'

import type { InMemoryDatabase } from './index.js'
import { migrateTable } from './migrations.js'
import type { LiveStoreJSQuery } from './reactiveQueries/js.js'
import { LiveStoreSQLQuery } from './reactiveQueries/sql.js'
import { dynamicallyRegisteredTables, SCHEMA_META_TABLE } from './schema.js'
import type { Store } from './store.js'
import { prepareBindValues, sql } from './utils/util.js'

export type StateType = 'singleton' | 'variable'

export type StateTableDefDefault = SqliteDsl.TableDefinition<
  string,
  SqliteDsl.Columns & {
    id: SqliteDsl.ColumnDefinition<SqliteDsl.FieldType.FieldTypeText<any, any>, false>
  }
>

export type StateTableDefinition<
  TTableDef extends StateTableDefDefault,
  TIsSingleColumn extends boolean,
  TStateType extends StateType,
> = {
  schema: TTableDef
  isSingleColumn: TIsSingleColumn
  type: TStateType
}

export const defineStateTable = <
  TName extends string,
  TColumns extends SqliteDsl.Columns | SqliteDsl.ColumnDefinition<any, any>,
  TStateType extends StateType = 'singleton',
>(
  name: TName,
  columnOrColumns: TColumns,
  type?: TStateType,
): StateTableDefinition<
  SqliteDsl.TableDefinition<
    `state__${TName}`,
    PrettifyFlat<WithId<TColumns extends SqliteDsl.Columns ? TColumns : { value: TColumns }, TStateType>>
  >,
  TColumns extends SqliteDsl.ColumnDefinition<any, any> ? true : false,
  TStateType
> => {
  const tablePath = `state__${name}` as const

  // eslint-disable-next-line unicorn/prefer-default-parameters
  const type_ = type ?? 'singleton'

  const columns = (SqliteDsl.isColumnDefinition(columnOrColumns)
    ? { value: columnOrColumns }
    : columnOrColumns) as unknown as PrettifyFlat<
    WithId<TColumns extends SqliteDsl.Columns ? TColumns : { value: TColumns }, TStateType>
  >

  // Check whether there are any non-id columns with primary key set to true
  for (const [columnName, column] of Object.entries(columns)) {
    if (columnName === 'id') continue
    if (column.primaryKey === true) {
      shouldNeverHappen(`LiveStore doesn't yet support columns other than 'id' to be primary keys.`)
    }
  }

  if (columns.id === undefined) {
    if (type_ === 'singleton') {
      columns.id = SqliteDsl.textWithSchema(Schema.literal('singleton'), { primaryKey: true, default: 'singleton' })
    } else {
      columns.id = SqliteDsl.text({ primaryKey: true })
    }
  } else if (columns.id.primaryKey !== true) {
    shouldNeverHappen(`Column 'id' must be a primary key for state table ${name}`)
  }

  const tableDef = SqliteDsl.table(tablePath, columns, [])

  if (dynamicallyRegisteredTables.has(tablePath)) {
    if (SqliteAst.hash(dynamicallyRegisteredTables.get(tablePath)!) !== SqliteAst.hash(tableDef.ast)) {
      console.error('previous tableDef', dynamicallyRegisteredTables.get(tablePath), 'new tableDef', tableDef.ast)
      return shouldNeverHappen(`Table with name "${name}" was already previously defined with a different definition`)
    }
  } else {
    dynamicallyRegisteredTables.set(tablePath, tableDef.ast)
  }

  return {
    schema: tableDef,
    isSingleColumn: (SqliteDsl.isColumnDefinition(columnOrColumns) === true) as any,
    type: type_ as TStateType,
  }
}

export type StateQueryArgs<TStateTableDef extends StateTableDefinition<any, boolean, StateType>> =
  TStateTableDef['type'] extends 'singleton'
    ? {
        def: TStateTableDef
        store: Store
        otelContext?: otel.Context
      }
    : {
        def: TStateTableDef
        store: Store
        otelContext?: otel.Context
        id: string
      }

export const stateQuery = <TStateTableDef extends StateTableDefinition<StateTableDefDefault, boolean, StateType>>(
  args: StateQueryArgs<TStateTableDef>,
): LiveStoreJSQuery<StateResult<TStateTableDef>> => {
  const { def, store } = args
  const otelContext = args.otelContext ?? store.otel.queriesSpanContext
  const id: string | undefined = (args as any).id

  // Validate query args
  if (def.type === 'singleton' && id !== undefined) {
    shouldNeverHappen(`Cannot query state table ${def.schema.name} with id "${id}" as it is a singleton`)
  } else if (def.type === 'variable' && id === undefined) {
    shouldNeverHappen(`Cannot query state table ${def.schema.name} without id`)
  }

  const stateSchema = def.schema
  const componentTableName = stateSchema.name

  type TComponentState = SqliteDsl.FromColumns.RowDecoded<TStateTableDef['schema']['columns']>

  const componentStateEffectSchema = SqliteDsl.structSchemaForTable(stateSchema)

  // TODO find a better solution for this
  if (store.tableRefs[componentTableName] === undefined) {
    const schemaHash = SqliteAst.hash(stateSchema.ast)
    const res = store.inMemoryDB.select<{ schemaHash: number }>(
      sql`SELECT schemaHash FROM ${SCHEMA_META_TABLE} WHERE tableName = '${componentTableName}'`,
    )
    if (res.length === 0 || res[0]!.schemaHash !== schemaHash) {
      migrateTable({
        db: store._proxyDb,
        tableDef: stateSchema.ast,
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

  // TODO find a way to only do this if necessary
  insertRowForStateInstance({
    db: store._proxyDb,
    id: id ?? 'singleton',
    stateSchema,
    otelContext,
  })

  const whereClause = id === undefined ? '' : `where id = '${id}'`
  const queryStr = sql`select * from ${componentTableName} ${whereClause} limit 1`

  return new LiveStoreSQLQuery({
    label: `localState:query:${stateSchema.name}${id === undefined ? '' : `:${id}`}`,
    genQueryString: queryStr,
    queriedTables: new Set([componentTableName]),
  }).pipe<TComponentState>((results) => {
    if (results.length === 0) return shouldNeverHappen(`No results for query ${queryStr}`)

    const parseResult = Schema.parseEither(componentStateEffectSchema)(results[0]!)

    if (parseResult._tag === 'Left') {
      console.error('decode error', TreeFormatter.formatErrors(parseResult.left.errors), 'results', results)
      return shouldNeverHappen(`Error decoding query result for ${queryStr}`)
    }

    return def.isSingleColumn === true ? parseResult.right.value : parseResult.right
  }) as unknown as LiveStoreJSQuery<StateResult<TStateTableDef>>
}

type GetValForKey<T, K> = K extends keyof T ? T[K] : never

export type StateResult<TStateTableDef extends StateTableDefinition<any, boolean, StateType>> =
  TStateTableDef['isSingleColumn'] extends true
    ? GetValForKey<SqliteDsl.FromColumns.RowDecoded<TStateTableDef['schema']['columns']>, 'value'>
    : SqliteDsl.FromColumns.RowDecoded<TStateTableDef['schema']['columns']>

export type StateResultEncoded<TStateTableDef extends StateTableDefinition<any, boolean, StateType>> =
  TStateTableDef['isSingleColumn'] extends true
    ? GetValForKey<SqliteDsl.FromColumns.RowEncoded<TStateTableDef['schema']['columns']>, 'value'>
    : SqliteDsl.FromColumns.RowEncoded<TStateTableDef['schema']['columns']>

/**
 * Create a row storing the state for a component instance, if none exists yet.
 * Initialized with default values, and keyed on the component key.
 */
const insertRowForStateInstance = ({
  db,
  id,
  stateSchema,
  otelContext,
}: {
  db: InMemoryDatabase
  id: string
  stateSchema: SqliteDsl.TableDefinition<string, SqliteDsl.Columns>
  otelContext: otel.Context
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
      column.default === undefined
        ? column.nullable === true
          ? null
          : shouldNeverHappen(`Column ${columnName} has no default value and is not nullable`)
        : Schema.encodeSync(column.type.codec)(column.default ?? null),
    ),
  )

  void db.execute(insertQuery, prepareBindValues({ ...defaultValues, id }, insertQuery), [tableName], { otelContext })
}

type WithId<TColumns extends SqliteDsl.Columns, TStateType extends StateType> = TColumns &
  (TStateType extends 'singleton'
    ? {
        id: SqliteDsl.ColumnDefinition<SqliteDsl.FieldType.FieldTypeText<'singleton', 'singleton'>, false>
      }
    : {
        id: SqliteDsl.ColumnDefinition<SqliteDsl.FieldType.FieldTypeText<string, string>, false>
      })
