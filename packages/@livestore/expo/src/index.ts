import {
  type DatabaseFactory,
  type DatabaseImpl,
  getExecArgsFromMutation,
  initializeSingletonTables,
  type InMemoryDatabase,
  migrateDb,
  migrateTable,
  rehydrateFromMutationLog,
  type StorageDatabase,
} from '@livestore/common'
import { makeMutationEventSchema, MUTATION_LOG_META_TABLE, mutationLogMetaTable } from '@livestore/common/schema'
import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import * as SQLite from 'expo-sqlite/next'

export type MakeDbOptions = {
  fileNamePrefix?: string
  subDirectory?: string
}

export const makeDb =
  (options?: MakeDbOptions): DatabaseFactory =>
  ({ schema }) => {
    const { fileNamePrefix, subDirectory } = options ?? {}
    const migrationOptions = schema.migrationOptions
    const subDirectoryPath = subDirectory ? subDirectory.replace(/\/$/, '') + '/' : ''
    const fullDbFilePath = `${subDirectoryPath}${fileNamePrefix ?? 'livestore-'}${schema.hash}.db`
    const db = SQLite.openDatabaseSync(fullDbFilePath)

    const mainDb = makeMainDb(db)

    const dbWasEmptyWhenOpenedStmt = mainDb.prepare('SELECT 1 FROM sqlite_master')
    const dbWasEmptyWhenOpened = dbWasEmptyWhenOpenedStmt.select(undefined).length === 0

    const dbLog = SQLite.openDatabaseSync(`${subDirectory ?? ''}${fileNamePrefix ?? 'livestore-'}mutationlog.db`)
    const mainDbLog = makeMainDb(dbLog)

    migrateTable({
      db: mainDbLog,
      behaviour: 'create-if-not-exists',
      tableAst: mutationLogMetaTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    if (dbWasEmptyWhenOpened) {
      const otelContext = otel.context.active()

      migrateDb({ db: mainDb, otelContext, schema })

      initializeSingletonTables(schema, mainDb)

      switch (migrationOptions.strategy) {
        case 'from-mutation-log': {
          rehydrateFromMutationLog({
            db: mainDb,
            logDb: mainDbLog,
            schema,
            migrationOptions,
          })

          break
        }
        case 'hard-reset': {
          // This is already the case by note doing anything now

          break
        }
        case 'manual': {
          // const migrateFn = migrationStrategy.migrate
          console.warn('Manual migration strategy not implemented yet')

          // TODO figure out a way to get previous database file to pass to the migration function

          break
        }
        default: {
          casesHandled(migrationOptions)
        }
      }
    }

    const mutationLogExclude =
      migrationOptions.strategy === 'from-mutation-log'
        ? migrationOptions.excludeMutations ?? new Set(['livestore.RawSql'])
        : new Set(['livestore.RawSql'])

    // TODO refactor
    const mutationEventSchema = makeMutationEventSchema(Object.fromEntries(schema.mutations.entries()) as any)
    const mutationDefSchemaHashMap = new Map(
      [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    const newMutationLogStmt = mainDbLog.prepare(
      `INSERT INTO ${MUTATION_LOG_META_TABLE} (id, mutation, argsJson, schemaHash, createdAt) VALUES (?, ?, ?, ?, ?)`,
    )

    const storageDb = {
      execute: async () => {},
      mutate: async (mutationEventEncoded) => {
        if (migrationOptions.strategy !== 'from-mutation-log') return

        const mutation = mutationEventEncoded.mutation
        const mutationDef = schema.mutations.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)
        const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        // write to mutation_log
        if (
          mutationLogExclude.has(mutation) === false &&
          execArgsArr.some((_) => _.statementSql.includes('__livestore')) === false
        ) {
          const mutationDefSchemaHash =
            mutationDefSchemaHashMap.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)

          const argsJson = JSON.stringify(mutationEventEncoded.args ?? {})

          try {
            newMutationLogStmt.execute([
              mutationEventEncoded.id,
              mutationEventEncoded.mutation,
              argsJson,
              mutationDefSchemaHash,
              new Date().toISOString(),
            ] as any)
          } catch (e) {
            console.error(
              'Error writing to mutation_log',
              e,
              mutationEventEncoded.id,
              mutationEventEncoded.mutation,
              argsJson,
              mutationDefSchemaHash,
            )
            debugger
            throw e
          }
        } else {
          //   console.debug('livestore-webworker: skipping mutation log write', mutation, statementSql, bindValues)
        }
      },
      export: async () => mainDb.export(),
      // TODO actually implement this
      getInitialSnapshot: async () => new Uint8Array(),
      // TODO actually implement this
      dangerouslyReset: async () => {},
      getMutationLogData: async () => mainDbLog.export(),
      shutdown: async () => {},
    } satisfies StorageDatabase

    return { mainDb, storageDb } satisfies DatabaseImpl
  }

const makeMainDb = (db: SQLite.SQLiteDatabase) => {
  return {
    _tag: 'InMemoryDatabase',
    prepare: (value) => {
      try {
        const stmt = db.prepareSync(value)
        return {
          execute: (bindValues) => {
            const res = stmt.executeSync(bindValues ?? [])
            res.resetSync()
            return () => res.changes
          },
          select: (bindValues) => {
            const res = stmt.executeSync(bindValues ?? [])
            try {
              return res.getAllSync() as any
            } finally {
              res.resetSync()
            }
          },
          finalize: () => stmt.finalizeSync(),
        }
      } catch (e) {
        console.error(`Error preparing statement: ${value}`, e)
        return shouldNeverHappen(`Error preparing statement: ${value}`)
      }
    },
    execute: (queryStr, bindValues) => {
      const stmt = db.prepareSync(queryStr)
      try {
        const res = stmt.executeSync(bindValues ?? [])
        return () => res.changes
      } finally {
        stmt.finalizeSync()
      }
    },
    export: () => {
      console.error(`export not yet implemented`)
      return new Uint8Array([])
    },
    dangerouslyReset: async () => {
      console.error(`dangerouslyReset not yet implemented`)
    },
  } satisfies InMemoryDatabase
}
