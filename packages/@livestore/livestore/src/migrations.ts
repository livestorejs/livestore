import type * as otel from '@opentelemetry/api'
import { SqliteAst } from 'effect-db-schema'
import { memoize, omit } from 'lodash-es'

import type { InMemoryDatabase } from './index.js'
import type { Schema, SchemaMetaRow } from './schema.js'
import { componentStateTables, SCHEMA_META_TABLE, systemTables } from './schema.js'
import { sql } from './util.js'

// TODO more graceful DB migration (e.g. backup DB before destructive migrations)
export const migrateDb = ({
  db,
  otelContext,
  schema,
}: {
  db: InMemoryDatabase
  otelContext: otel.Context
  schema: Schema
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

  const getMemoizedTimestamp = memoize(() => new Date().toISOString())
  const tableDefs = {
    // NOTE it's important the `SCHEMA_META_TABLE` comes first since we're writing to it below
    [SCHEMA_META_TABLE]: systemTables[SCHEMA_META_TABLE],
    ...omit(schema.tables, [SCHEMA_META_TABLE]),
    ...componentStateTables,
  }

  for (const [tableName, tableDef] of Object.entries(tableDefs)) {
    const dbSchemaHash = dbSchemaHashByTable[tableName]
    const schemaHash = SqliteAst.hash(tableDef)
    if (schemaHash !== dbSchemaHash) {
      console.log(
        `Schema hash mismatch for table '${tableName}' (DB: ${dbSchemaHash}, expected: ${schemaHash}), migrating table...`,
      )

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
        { tableName, schemaHash, updatedAt },
        [],
        { otelContext },
      )
    }
  }
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
  const columnType = column.type._tag
  // const primaryKey = column.primaryKey ? 'primary key' : ''
  const nullable = column.nullable === false ? 'not null' : ''
  const defaultValue =
    column.default === undefined
      ? ''
      : columnType === 'text'
      ? `default '${column.default}'`
      : `default ${column.default}`

  return `${column.name} ${columnType} ${nullable} ${defaultValue}`
}
