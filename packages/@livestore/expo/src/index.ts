import type { Adapter, ClientSession, LockStatus, PreparedBindValues } from '@livestore/common'
import {
  getExecArgsFromMutation,
  initializeSingletonTables,
  liveStoreStorageFormatVersion,
  migrateDb,
  migrateTable,
  rehydrateFromMutationLog,
  sql,
  UnexpectedError,
} from '@livestore/common'
import type { PullQueueItem } from '@livestore/common/leader-thread'
import type { MutationLogMetaRow } from '@livestore/common/schema'
import { EventId, MUTATION_LOG_META_TABLE, MutationEvent, mutationLogMetaTable } from '@livestore/common/schema'
import { insertRowPrepared, makeBindValues } from '@livestore/common/sql-queries'
import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import { Effect, Option, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'
import * as SQLite from 'expo-sqlite'

import { makeSqliteDb } from './common.js'
import type { BootedDevtools } from './devtools.js'
import { bootDevtools } from './devtools.js'

export type MakeDbOptions = {
  fileNamePrefix?: string
  subDirectory?: string
  // syncBackend?: TODO
}

// TODO refactor with leader-thread code from `@livestore/common/leader-thread`
export const makeAdapter =
  (options?: MakeDbOptions): Adapter =>
  ({ schema, connectDevtoolsToStore, shutdown, devtoolsEnabled }) =>
    Effect.gen(function* () {
      const { fileNamePrefix, subDirectory } = options ?? {}
      const migrationOptions = schema.migrationOptions
      const subDirectoryPath = subDirectory ? subDirectory.replace(/\/$/, '') + '/' : ''
      const fullDbFilePath = `${subDirectoryPath}${fileNamePrefix ?? 'livestore-'}${schema.hash}@${liveStoreStorageFormatVersion}.db`
      const db = SQLite.openDatabaseSync(fullDbFilePath)

      const dbRef = { current: { db, sqliteDb: makeSqliteDb(db) } }

      const dbWasEmptyWhenOpened = dbRef.current.sqliteDb.select('SELECT 1 FROM sqlite_master').length === 0

      const dbMutationLog = SQLite.openDatabaseSync(
        `${subDirectory ?? ''}${fileNamePrefix ?? 'livestore-'}mutationlog@${liveStoreStorageFormatVersion}.db`,
      )

      const dbMutationLogRef = { current: { db: dbMutationLog, sqliteDb: makeSqliteDb(dbMutationLog) } }

      const dbMutationLogWasEmptyWhenOpened =
        dbMutationLogRef.current.sqliteDb.select('SELECT 1 FROM sqlite_master').length === 0

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          // Ignoring in case the database is already closed
          yield* Effect.try(() => db.closeSync()).pipe(Effect.ignore)
          yield* Effect.try(() => dbMutationLog.closeSync()).pipe(Effect.ignore)
        }),
      )

      if (dbMutationLogWasEmptyWhenOpened) {
        yield* migrateTable({
          db: dbMutationLogRef.current.sqliteDb,
          behaviour: 'create-if-not-exists',
          tableAst: mutationLogMetaTable.sqliteDef.ast,
          skipMetaTable: true,
        })
      }

      if (dbWasEmptyWhenOpened) {
        yield* migrateDb({ db: dbRef.current.sqliteDb, schema })

        initializeSingletonTables(schema, dbRef.current.sqliteDb)

        switch (migrationOptions.strategy) {
          case 'from-mutation-log': {
            // TODO bring back
            // yield* rehydrateFromMutationLog({
            //   db: dbRef.current.sqliteDb,
            //   logDb: dbMutationLogRef.current.sqliteDb,
            //   schema,
            //   migrationOptions,
            //   onProgress: () => Effect.void,
            // })

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

      const mutationEventSchema = MutationEvent.makeMutationEventSchema(schema)
      const mutationDefSchemaHashMap = new Map(
        [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
      )

      const newMutationLogStmt = dbMutationLogRef.current.sqliteDb.prepare(
        insertRowPrepared({ tableName: MUTATION_LOG_META_TABLE, columns: mutationLogMetaTable.sqliteDef.columns }),
      )

      const lockStatus = SubscriptionRef.make<LockStatus>('has-lock').pipe(Effect.runSync)

      const incomingSyncMutationsQueue = yield* Queue.unbounded<PullQueueItem>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const initialMutationEventIdSchema = mutationLogMetaTable.schema.pipe(
        Schema.pick('idGlobal', 'idLocal'),
        Schema.transform(EventId.EventId, {
          encode: (_) => ({ idGlobal: _.global, idLocal: _.local }),
          decode: (_) => EventId.make({ global: _.idGlobal, local: _.idLocal }),
          strict: false,
        }),
        Schema.Array,
        Schema.headOrElse(() => EventId.make({ global: 0, local: 0 })),
      )

      const initialMutationEventId = yield* Schema.decode(initialMutationEventIdSchema)(
        dbMutationLogRef.current.sqliteDb.select(
          sql`SELECT idGlobal, idLocal FROM ${MUTATION_LOG_META_TABLE} ORDER BY idGlobal DESC, idLocal DESC LIMIT 1`,
        ),
      )

      let devtools: BootedDevtools | undefined

      const clientSession = {
        devtools: { enabled: false },
        lockStatus,
        // Expo doesn't support multiple client sessions, so we just use a fixed session id
        clientId: 'expo',
        sessionId: 'expo',
        leaderThread: {
          mutations: {
            initialMutationEventId,
            pull: Stream.fromQueue(incomingSyncMutationsQueue),
            push: (batch): Effect.Effect<void, UnexpectedError> =>
              Effect.gen(function* () {
                for (const mutationEventEncoded of batch) {
                  if (migrationOptions.strategy !== 'from-mutation-log') return

                  const mutation = mutationEventEncoded.mutation
                  const mutationDef =
                    schema.mutations.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)

                  const execArgsArr = getExecArgsFromMutation({
                    mutationDef,
                    mutationEvent: { decoded: undefined, encoded: mutationEventEncoded },
                  })

                  // write to mutation_log
                  if (
                    mutationLogExclude.has(mutation) === false &&
                    execArgsArr.some((_) => _.statementSql.includes('__livestore')) === false
                  ) {
                    const mutationDefSchemaHash =
                      mutationDefSchemaHashMap.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)

                    const argsJson = JSON.stringify(mutationEventEncoded.args ?? {})
                    const mutationLogRowValues = {
                      idGlobal: mutationEventEncoded.id.global,
                      idLocal: mutationEventEncoded.id.local,
                      mutation: mutationEventEncoded.mutation,
                      argsJson,
                      schemaHash: mutationDefSchemaHash,
                      syncMetadataJson: Option.none(),
                      parentIdGlobal: mutationEventEncoded.parentId.global,
                      parentIdLocal: mutationEventEncoded.parentId.local,
                    } satisfies MutationLogMetaRow

                    try {
                      newMutationLogStmt.execute(
                        makeBindValues({
                          columns: mutationLogMetaTable.sqliteDef.columns,
                          values: mutationLogRowValues,
                          variablePrefix: '$',
                        }) as PreparedBindValues,
                      )
                    } catch (e) {
                      console.error('Error writing to mutation_log', e, mutationLogRowValues)
                      debugger
                      throw e
                    }
                  } else {
                    //   console.debug('livestore-webworker: skipping mutation log write', mutation, statementSql, bindValues)
                  }

                  yield* devtools?.onMutation({ mutationEventEncoded }) ?? Effect.void
                }
              }),
          },
          export: Effect.sync(() => dbRef.current.sqliteDb.export()),
          getMutationLogData: Effect.sync(() => dbMutationLogRef.current.sqliteDb.export()),
          networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
          sendDevtoolsMessage: () => Effect.dieMessage('Not implemented'),
          getSyncState: Effect.dieMessage('Not implemented'),
        },
        shutdown: () => Effect.dieMessage('TODO implement shutdown'),
        sqliteDb: dbRef.current.sqliteDb,
      } satisfies ClientSession

      if (devtoolsEnabled) {
        devtools = yield* bootDevtools({
          connectDevtoolsToStore,
          clientSession,
          schema,
          dbRef,
          dbMutationLogRef,
          shutdown,
          incomingSyncMutationsQueue,
        }).pipe(
          Effect.tapCauseLogPretty,
          Effect.catchAll(() => Effect.succeed(undefined)),
        )
      }

      return clientSession
    }).pipe(
      Effect.mapError((cause) => (cause._tag === 'LiveStore.UnexpectedError' ? cause : new UnexpectedError({ cause }))),
      Effect.tapCauseLogPretty,
    )
