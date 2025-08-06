import { memoizeByStringifyArgs } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.ts'
import type { MigrationsReport, MigrationsReportEntry } from '../defs.ts'
import type { UnexpectedError } from '../errors.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { makeColumnSpec } from '../schema/state/sqlite/column-spec.ts'
import { SqliteAst } from '../schema/state/sqlite/db-schema/mod.ts'
import type { SchemaEventDefsMetaRow, SchemaMetaRow } from '../schema/state/sqlite/system-tables.ts'
import {
  isStateSystemTable,
  SCHEMA_EVENT_DEFS_META_TABLE,
  SCHEMA_META_TABLE,
  schemaEventDefsMetaTable,
  stateSystemTables,
} from '../schema/state/sqlite/system-tables.ts'
import { sql } from '../util.ts'
import type { SchemaManager } from './common.ts'
import { dbExecute, dbSelect } from './common.ts'
import { validateSchema } from './validate-schema.ts'

const getMemoizedTimestamp = memoizeByStringifyArgs(() => new Date().toISOString())

export const makeSchemaManager = (db: SqliteDb): Effect.Effect<SchemaManager> =>
  Effect.gen(function* () {
    yield* migrateTable({
      db,
      tableAst: schemaEventDefsMetaTable.sqliteDef.ast,
      behaviour: 'create-if-not-exists',
    })

    return {
      getEventDefInfos: () => dbSelect<SchemaEventDefsMetaRow>(db, sql`SELECT * FROM ${SCHEMA_EVENT_DEFS_META_TABLE}`),

      setEventDefInfo: (info) => {
        dbExecute(
          db,
          sql`INSERT OR REPLACE INTO ${SCHEMA_EVENT_DEFS_META_TABLE} (eventName, schemaHash, updatedAt) VALUES ($eventName, $schemaHash, $updatedAt)`,
          {
            eventName: info.eventName,
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
    for (const tableDef of stateSystemTables) {
      yield* migrateTable({
        db,
        tableAst: tableDef.sqliteDef.ast,
        behaviour: 'create-if-not-exists',
      })
    }

    // TODO enforce that migrating tables isn't allowed once the store is running

    const schemaManager = yield* makeSchemaManager(db)
    yield* validateSchema(schema, schemaManager)

    const schemaMetaRows = dbSelect<SchemaMetaRow>(db, sql`SELECT * FROM ${SCHEMA_META_TABLE}`)

    const dbSchemaHashByTable = Object.fromEntries(
      schemaMetaRows.map(({ tableName, schemaHash }) => [tableName, schemaHash]),
    )

    const tableDefs = [
      // NOTE it's important the `SCHEMA_META_TABLE` comes first since we're writing to it below
      ...stateSystemTables,
      ...Array.from(schema.state.sqlite.tables.values()).filter((_) => !isStateSystemTable(_.sqliteDef.name)),
    ]

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
  return sql`create ${uniqueStr} index if not exists '${index.name}' on '${tableName}' (${index.columns.map((col) => `'${col}'`).join(', ')})`
}
