import { memoize } from '@livestore/utils'
import { Schema as EffectSchema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import { SqliteAst, SqliteDsl } from 'effect-db-schema'

import type { MainDatabase } from '../database.js'
import type { LiveStoreSchema } from '../schema/index.js'
import type { SchemaMetaRow } from '../schema/system-tables.js'
import { SCHEMA_META_TABLE, schemaMetaTable, systemTables } from '../schema/system-tables.js'
import { sql } from '../util.js'
import { dbExecute, dbSelect } from './common.js'
import { makeSchemaManager, validateSchema } from './validate-mutation-defs.js'

const getMemoizedTimestamp = memoize(() => new Date().toISOString())

// TODO more graceful DB migration (e.g. backup DB before destructive migrations)
export const migrateDb = ({
  db,
  otelContext = otel.context.active(),
  schema,
}: {
  db: MainDatabase
  otelContext?: otel.Context
  schema: LiveStoreSchema
}) => {
  migrateTable({
    db,
    otelContext,
    tableAst: schemaMetaTable.sqliteDef.ast,
    behaviour: 'create-if-not-exists',
  })

  validateSchema(schema, makeSchemaManager(db))

  const schemaMetaRows = dbSelect<SchemaMetaRow>(db, sql`SELECT * FROM ${SCHEMA_META_TABLE}`)

  const dbSchemaHashByTable = Object.fromEntries(
    schemaMetaRows.map(({ tableName, schemaHash }) => [tableName, schemaHash]),
  )

  const tableDefs = new Set([
    // NOTE it's important the `SCHEMA_META_TABLE` comes first since we're writing to it below
    ...systemTables,
    ...Array.from(schema.tables.values()).filter((_) => _.sqliteDef.name !== SCHEMA_META_TABLE),
  ])

  for (const tableDef of tableDefs) {
    const tableAst = tableDef.sqliteDef.ast
    const tableName = tableAst.name
    const dbSchemaHash = dbSchemaHashByTable[tableName]
    const schemaHash = SqliteAst.hash(tableAst)

    // @ts-expect-error TODO fix typing
    const skipMigrations = import.meta.env.VITE_LIVESTORE_SKIP_MIGRATIONS !== undefined

    if (schemaHash !== dbSchemaHash && skipMigrations === false) {
      console.log(
        `Schema hash mismatch for table '${tableName}' (DB: ${dbSchemaHash}, expected: ${schemaHash}), migrating table...`,
      )

      migrateTable({ db, tableAst, otelContext, schemaHash, behaviour: 'drop-and-recreate' })
    }
  }
}

export const migrateTable = ({
  db,
  tableAst,
  // otelContext,
  schemaHash = SqliteAst.hash(tableAst),
  behaviour,
  skipMetaTable = false,
}: {
  db: MainDatabase
  tableAst: SqliteAst.Table
  otelContext?: otel.Context
  schemaHash?: number
  behaviour: 'drop-and-recreate' | 'create-if-not-exists'
  skipMetaTable?: boolean
}) => {
  console.log(`Migrating table '${tableAst.name}'...`)
  const tableName = tableAst.name
  const columnSpec = makeColumnSpec(tableAst)

  if (behaviour === 'drop-and-recreate') {
    // TODO need to possibly handle cascading deletes due to foreign keys
    dbExecute(db, sql`drop table if exists ${tableName}`)
    dbExecute(db, sql`create table if not exists ${tableName} (${columnSpec}) strict`)
  } else if (behaviour === 'create-if-not-exists') {
    dbExecute(db, sql`create table if not exists ${tableName} (${columnSpec}) strict`)
  }

  for (const index of tableAst.indexes) {
    dbExecute(db, createIndexFromDefinition(tableName, index))
  }

  if (skipMetaTable !== true) {
    const updatedAt = getMemoizedTimestamp()

    dbExecute(
      db,
      sql`
      INSERT INTO ${SCHEMA_META_TABLE} (tableName, schemaHash, updatedAt) VALUES ($tableName, $schemaHash, $updatedAt)
        ON CONFLICT (tableName) DO UPDATE SET schemaHash = $schemaHash, updatedAt = $updatedAt;
    `,
      { tableName, schemaHash, updatedAt },
    )
  }
}

const createIndexFromDefinition = (tableName: string, index: SqliteAst.Index) => {
  const uniqueStr = index.unique ? 'UNIQUE' : ''
  return sql`create ${uniqueStr} index ${index.name} on ${tableName} (${index.columns.join(', ')})`
}

const makeColumnSpec = (tableAst: SqliteAst.Table) => {
  const primaryKeys = tableAst.columns.filter((_) => _.primaryKey).map((_) => _.name)
  const columnDefStrs = tableAst.columns.map(toSqliteColumnSpec)
  if (primaryKeys.length > 0) {
    columnDefStrs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
  }

  return columnDefStrs.join(', ')
}

/** NOTE primary keys are applied on a table level not on a column level to account for multi-column primary keys */
const toSqliteColumnSpec = (column: SqliteAst.Column) => {
  const columnTypeStr = column.type._tag
  const nullableStr = column.nullable === false ? 'not null' : ''
  const defaultValueStr = (() => {
    if (column.default._tag === 'None') return ''

    if (SqliteDsl.isSqlDefaultValue(column.default.value)) return `default ${column.default.value.sql}`

    const encodeValue = EffectSchema.encodeSync(column.schema)
    const encodedDefaultValue = encodeValue(column.default.value)

    if (columnTypeStr === 'text') return `default '${encodedDefaultValue}'`
    return `default ${encodedDefaultValue}`
  })()

  return `${column.name} ${columnTypeStr} ${nullableStr} ${defaultValueStr}`
}
