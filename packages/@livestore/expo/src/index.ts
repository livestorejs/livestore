import type { Coordinator, LockStatus, StoreAdapter, StoreAdapterFactory } from '@livestore/common'
import {
  getExecArgsFromMutation,
  initializeSingletonTables,
  migrateDb,
  migrateTable,
  rehydrateFromMutationLog,
  UnexpectedError,
} from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import { makeMutationEventSchema, MUTATION_LOG_META_TABLE, mutationLogMetaTable } from '@livestore/common/schema'
import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import { Effect, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'
import * as SQLite from 'expo-sqlite/next'

import { makeSynchronousDatabase } from './common.js'
import { bootDevtools } from './devtools.js'

export type MakeDbOptions = {
  fileNamePrefix?: string
  subDirectory?: string
}

export const makeAdapter =
  (options?: MakeDbOptions): StoreAdapterFactory =>
  ({ schema, connectDevtoolsToStore, shutdown }) =>
    Effect.gen(function* () {
      const { fileNamePrefix, subDirectory } = options ?? {}
      const migrationOptions = schema.migrationOptions
      const subDirectoryPath = subDirectory ? subDirectory.replace(/\/$/, '') + '/' : ''
      const fullDbFilePath = `${subDirectoryPath}${fileNamePrefix ?? 'livestore-'}${schema.hash}.db`
      const db = SQLite.openDatabaseSync(fullDbFilePath)

      const dbRef = { current: { db, syncDb: makeSynchronousDatabase(db) } }

      const dbWasEmptyWhenOpenedStmt = dbRef.current.syncDb.prepare('SELECT 1 FROM sqlite_master')
      const dbWasEmptyWhenOpened = dbWasEmptyWhenOpenedStmt.select(undefined).length === 0

      const dbLog = SQLite.openDatabaseSync(`${subDirectory ?? ''}${fileNamePrefix ?? 'livestore-'}mutationlog.db`)

      const dbLogRef = { current: { db: dbLog, syncDb: makeSynchronousDatabase(dbLog) } }

      const dbLogWasEmptyWhenOpenedStmt = dbLogRef.current.syncDb.prepare('SELECT 1 FROM sqlite_master')
      const dbLogWasEmptyWhenOpened = dbLogWasEmptyWhenOpenedStmt.select(undefined).length === 0

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          // Ignoring in case the database is already closed
          yield* Effect.try(() => db.closeSync()).pipe(Effect.ignore)
          yield* Effect.try(() => dbLog.closeSync()).pipe(Effect.ignore)
        }),
      )

      if (dbLogWasEmptyWhenOpened) {
        yield* migrateTable({
          db: dbLogRef.current.syncDb,
          behaviour: 'create-if-not-exists',
          tableAst: mutationLogMetaTable.sqliteDef.ast,
          skipMetaTable: true,
        })
      }

      if (dbWasEmptyWhenOpened) {
        yield* migrateDb({ db: dbRef.current.syncDb, schema })

        initializeSingletonTables(schema, dbRef.current.syncDb)

        switch (migrationOptions.strategy) {
          case 'from-mutation-log': {
            yield* rehydrateFromMutationLog({
              db: dbRef.current.syncDb,
              logDb: dbLogRef.current.syncDb,
              schema,
              migrationOptions,
              onProgress: () => Effect.void,
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
          ? (migrationOptions.excludeMutations ?? new Set(['livestore.RawSql']))
          : new Set(['livestore.RawSql'])

      const mutationEventSchema = makeMutationEventSchema(schema)
      const mutationDefSchemaHashMap = new Map(
        [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
      )

      const newMutationLogStmt = dbLogRef.current.syncDb.prepare(
        `INSERT INTO ${MUTATION_LOG_META_TABLE} (id, mutation, argsJson, schemaHash, createdAt, syncStatus) VALUES (?, ?, ?, ?, ?, ?)`,
      )

      const lockStatus = SubscriptionRef.make<LockStatus>('has-lock').pipe(Effect.runSync)

      const incomingSyncMutationsQueue = yield* Queue.unbounded<MutationEvent.Any>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const coordinator = {
        devtools: { appHostId: 'expo', enabled: false },
        lockStatus,
        syncMutations: Stream.fromQueue(incomingSyncMutationsQueue),
        // NOTE not doing anything since syncDb is already persisted
        execute: () => Effect.void,
        mutate: (mutationEventEncoded, { persisted }): Effect.Effect<void, UnexpectedError> =>
          Effect.gen(function* () {
            if (migrationOptions.strategy !== 'from-mutation-log') return

            const mutation = mutationEventEncoded.mutation
            const mutationDef = schema.mutations.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)
            const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

            const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

            // write to mutation_log
            if (
              persisted === true &&
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
                  'localOnly',
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

            yield* devtools.onMutation({ mutationEventEncoded, persisted })
          }),
        export: Effect.sync(() => dbRef.current.syncDb.export()),
        // TODO this is only needed in the web-adapter, so find a way to remove it in the adapter interface
        getInitialSnapshot: Effect.never,
        getMutationLogData: Effect.sync(() => dbLogRef.current.syncDb.export()),
        networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
      } satisfies Coordinator

      const devtools = yield* bootDevtools({
        connectDevtoolsToStore,
        coordinator,
        schema,
        dbRef,
        dbLogRef,
        shutdown,
        incomingSyncMutationsQueue,
      })

      return { syncDb: dbRef.current.syncDb, coordinator } satisfies StoreAdapter
    }).pipe(Effect.mapError((cause) => new UnexpectedError({ cause })))
