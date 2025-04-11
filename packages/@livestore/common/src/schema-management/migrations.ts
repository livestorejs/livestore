import { memoizeByStringifyArgs } from '@livestore/utils'
import { Effect, Schema as EffectSchema } from '@livestore/utils/effect'

import type { MigrationsReport, MigrationsReportEntry, SqliteDb, UnexpectedError } from '../adapter-types.js'
import { SqliteAst, SqliteDsl } from '../schema/db-schema/mod.js'
import type { LiveStoreSchema } from '../schema/mod.js'
import type { SchemaMetaRow, SchemaMutationsMetaRow } from '../schema/system-tables.js'
import {
  SCHEMA_META_TABLE,
  SCHEMA_MUTATIONS_META_TABLE,
  schemaMetaTable,
  schemaMutationsMetaTable,
  systemTables,
} from '../schema/system-tables.js'
import { sql } from '../util.js'
import type { SchemaManager } from './common.js'
import { dbExecute, dbSelect } from './common.js'
import { validateSchema } from './validate-mutation-defs.js'

const getMemoizedTimestamp = memoizeByStringifyArgs(() => new Date().toISOString())

export const makeSchemaManager = (db: SqliteDb): Effect.Effect<SchemaManager> =>
  Effect.gen(function* () {
    yield* migrateTable({
      db,
      tableAst: schemaMutationsMetaTable.sqliteDef.ast,
      behaviour: 'create-if-not-exists',
    })

    return {
      getEventDefInfos: () => dbSelect<SchemaMutationsMetaRow>(db, sql`SELECT * FROM ${SCHEMA_MUTATIONS_META_TABLE}`),

      setEventDefInfo: (info) => {
        dbExecute(
          db,
          sql`INSERT OR REPLACE INTO ${SCHEMA_MUTATIONS_META_TABLE} (mutationName, schemaHash, updatedAt) VALUES ($mutationName, $schemaHash, $updatedAt)`,
          {
            mutationName: info.mutationName,
            schemaHash: info.schemaHash,
            updatedAt: new Date().toISOString(),
          },
        )
      },
    }
  })

// TODO more graceful DB migration (e.g. backup DB before destructive migrations)
export const migrateDb = ({
  db,
  schema,
  onProgress,
}: {
  db: SqliteDb
  schema: LiveStoreSchema
  onProgress?: (opts: { done: number; total: number }) => Effect.Effect<void>
}): Effect.Effect<MigrationsReport, UnexpectedError> =>
  Effect.gen(function* () {
    yield* migrateTable({
      db,
      tableAst: schemaMetaTable.sqliteDef.ast,
      behaviour: 'create-if-not-exists',
    })

    // TODO enforce that migrating tables isn't allowed once the store is running

    const schemaManager = yield* makeSchemaManager(db)
    yield* validateSchema(schema, schemaManager)

    const schemaMetaRows = dbSelect<SchemaMetaRow>(db, sql`SELECT * FROM ${SCHEMA_META_TABLE}`)

    const dbSchemaHashByTable = Object.fromEntries(
      schemaMetaRows.map(({ tableName, schemaHash }) => [tableName, schemaHash]),
    )

    const tableDefs = new Set([
      // NOTE it's important the `SCHEMA_META_TABLE` comes first since we're writing to it below
      ...systemTables,
      ...Array.from(schema.tables.values()).filter((_) => _.sqliteDef.name !== SCHEMA_META_TABLE),
    ])

    const tablesToMigrate = new Set<{ tableAst: SqliteAst.Table; schemaHash: number }>()

    const migrationsReportEntries: MigrationsReportEntry[] = []
    for (const tableDef of tableDefs) {
      const tableAst = tableDef.sqliteDef.ast
      const tableName = tableAst.name
      const dbSchemaHash = dbSchemaHashByTable[tableName]
      const schemaHash = SqliteAst.hash(tableAst)

      if (schemaHash !== dbSchemaHash) {
        tablesToMigrate.add({ tableAst, schemaHash })

        migrationsReportEntries.push({
          tableName,
          hashes: { expected: schemaHash, actual: dbSchemaHash },
        })
      }
    }

    let processedTables = 0
    const tablesCount = tablesToMigrate.size

    for (const { tableAst, schemaHash } of tablesToMigrate) {
      yield* migrateTable({ db, tableAst, schemaHash, behaviour: 'create-if-not-exists' })

      if (onProgress !== undefined) {
        processedTables++
        yield* onProgress({ done: processedTables, total: tablesCount })
      }
    }

    return { migrations: migrationsReportEntries }
  })

export const migrateTable = ({
  db,
  tableAst,
  schemaHash = SqliteAst.hash(tableAst),
  behaviour,
  skipMetaTable = false,
}: {
  db: SqliteDb
  tableAst: SqliteAst.Table
  schemaHash?: number
  behaviour: 'drop-and-recreate' | 'create-if-not-exists'
  skipMetaTable?: boolean
}) =>
  Effect.gen(function* () {
    // console.log(`Migrating table '${tableAst.name}'...`)
    const tableName = tableAst.name
    const columnSpec = makeColumnSpec(tableAst)

    if (behaviour === 'drop-and-recreate') {
      // TODO need to possibly handle cascading deletes due to foreign keys
      dbExecute(db, sql`drop table if exists '${tableName}'`)
      dbExecute(db, sql`create table if not exists '${tableName}' (${columnSpec}) strict`)
    } else if (behaviour === 'create-if-not-exists') {
      dbExecute(db, sql`create table if not exists '${tableName}' (${columnSpec}) strict`)
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
  }).pipe(
    Effect.withSpan('@livestore/common:migrateTable', {
      attributes: {
        'span.label': tableAst.name,
        tableName: tableAst.name,
      },
    }),
  )

const createIndexFromDefinition = (tableName: string, index: SqliteAst.Index) => {
  const uniqueStr = index.unique ? 'UNIQUE' : ''
  return sql`create ${uniqueStr} index if not exists '${index.name}' on '${tableName}' (${index.columns.join(', ')})`
}

export const makeColumnSpec = (tableAst: SqliteAst.Table) => {
  const primaryKeys = tableAst.columns.filter((_) => _.primaryKey).map((_) => `'${_.name}'`)
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

  return `'${column.name}' ${columnTypeStr} ${nullableStr} ${defaultValueStr}`
}
