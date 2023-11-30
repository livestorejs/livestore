import { Schema as EffectSchema } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import { SqliteAst } from 'effect-db-schema'
import { memoize } from 'lodash-es'

import type { InMemoryDatabase } from './index.js'
import type { LiveStoreSchema, SchemaMetaRow } from './schema/index.js'
import { dynamicallyRegisteredTables, SCHEMA_META_TABLE, systemTables } from './schema/index.js'
import type { PreparedBindValues } from './utils/util.js'
import { sql } from './utils/util.js'

const getMemoizedTimestamp = memoize(() => new Date().toISOString())

// TODO more graceful DB migration (e.g. backup DB before destructive migrations)
export const migrateDb = ({
  db,
  otelContext,
  schema,
}: {
  db: InMemoryDatabase
  otelContext: otel.Context
  schema: LiveStoreSchema
}) => {
  db.execute(
    // TODO use schema migration definition from schema.ts instead
    sql`create table if not exists ${SCHEMA_META_TABLE} (tableName text primary key, schemaHash text, updatedAt text);`,
    undefined,
    [],
    { otelContext },
  )

  const schemaMetaRows = db.select<SchemaMetaRow>(sql`SELECT * FROM ${SCHEMA_META_TABLE}`)

  const dbSchemaHashByTable = Object.fromEntries(
    schemaMetaRows.map(({ tableName, schemaHash }) => [tableName, schemaHash]),
  )

  const tableDefs = new Set([
    // NOTE it's important the `SCHEMA_META_TABLE` comes first since we're writing to it below
    ...systemTables,
    ...Array.from(schema.tables.values()).filter((_) => _.name !== SCHEMA_META_TABLE),
    ...dynamicallyRegisteredTables.values(),
  ])

  for (const tableDef of tableDefs) {
    const tableName = tableDef.name
    const dbSchemaHash = dbSchemaHashByTable[tableName]
    const schemaHash = SqliteAst.hash(tableDef)
    if (schemaHash !== dbSchemaHash) {
      if (import.meta.env.VITE_LIVESTORE_SKIP_MIGRATIONS) {
        console.log(
          `Schema hash mismatch for table '${tableName}' (DB: ${dbSchemaHash}, expected: ${schemaHash}), skipping migration...`,
        )
      } else {
        console.log(
          `Schema hash mismatch for table '${tableName}' (DB: ${dbSchemaHash}, expected: ${schemaHash}), migrating table...`,
        )

        migrateTable({ db, tableDef, otelContext, schemaHash })
      }
    }
  }
}

export const migrateTable = ({
  db,
  tableDef,
  otelContext,
  schemaHash,
}: {
  db: InMemoryDatabase
  tableDef: SqliteAst.Table
  otelContext: otel.Context
  schemaHash: number
}) => {
  console.log(`Migrating table '${tableDef.name}'...`)
  const tableName = tableDef.name
  const columnSpec = makeColumnSpec(tableDef)

  // TODO need to possibly handle cascading deletes due to foreign keys
  db.execute(sql`drop table if exists ${tableName}`, undefined, [], { otelContext })
  db.execute(sql`create table if not exists ${tableName} (${columnSpec});`, undefined, [], { otelContext })

  for (const index of tableDef.indexes) {
    db.execute(createIndexFromDefinition(tableName, index), undefined, [], { otelContext })
  }

  const updatedAt = getMemoizedTimestamp()
  db.execute(
    sql`
      INSERT INTO ${SCHEMA_META_TABLE} (tableName, schemaHash, updatedAt) VALUES ($tableName, $schemaHash, $updatedAt)
        ON CONFLICT (tableName) DO UPDATE SET schemaHash = $schemaHash, updatedAt = $updatedAt;
    `,
    { $tableName: tableName, $schemaHash: schemaHash, $updatedAt: updatedAt } as unknown as PreparedBindValues,
    [],
    { otelContext },
  )
}

const createIndexFromDefinition = (tableName: string, index: SqliteAst.Index) => {
  const uniqueStr = index.unique ? 'UNIQUE' : ''
  return sql`create ${uniqueStr} index ${index.name} on ${tableName} (${index.columns.join(', ')})`
}

const makeColumnSpec = (tableDef: SqliteAst.Table) => {
  const primaryKeys = tableDef.columns.filter((_) => _.primaryKey).map((_) => _.name)
  const columnDefStrs = tableDef.columns.map(toSqliteColumnSpec)
  if (primaryKeys.length > 0) {
    columnDefStrs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
  }

  return columnDefStrs.join(', ')
}

const toSqliteColumnSpec = (column: SqliteAst.Column) => {
  const columnTypeStr = column.type._tag
  // TODO bring back primary key support
  // const primaryKey = column.primaryKey ? 'primary key' : ''
  const nullableStr = column.nullable === false ? 'not null' : ''
  const defaultValueStr = (() => {
    if (column.default === undefined) return ''

    const encodeValue = EffectSchema.encodeSync(column.codec)
    const encodedDefaultValue = encodeValue(column.default ?? null)

    return columnTypeStr === 'text' ? `default '${encodedDefaultValue}'` : `default ${encodedDefaultValue}`
  })()

  return `${column.name} ${columnTypeStr} ${nullableStr} ${defaultValueStr}`
}
