import type { Adapter, ClientSession, Coordinator, EventId, LockStatus, PreparedBindValues } from '@livestore/common'
import {
  getExecArgsFromMutation,
  initializeSingletonTables,
  liveStoreStorageFormatVersion,
  makeNextMutationEventIdPair,
  migrateDb,
  migrateTable,
  rehydrateFromMutationLog,
  sql,
  UnexpectedError,
} from '@livestore/common'
import type { PullQueueItem } from '@livestore/common/leader-thread'
import type { MutationLogMetaRow } from '@livestore/common/schema'
import { makeMutationEventSchema, MUTATION_LOG_META_TABLE, mutationLogMetaTable } from '@livestore/common/schema'
import { insertRowPrepared, makeBindValues } from '@livestore/common/sql-queries'
import { casesHandled, shouldNeverHappen } from '@livestore/utils'
import { Effect, Option, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'
import * as SQLite from 'expo-sqlite'

import { makeSynchronousDatabase } from './common.js'
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

      const dbRef = { current: { db, syncDb: makeSynchronousDatabase(db) } }

      const dbWasEmptyWhenOpened = dbRef.current.syncDb.select('SELECT 1 FROM sqlite_master').length === 0

      const dbLog = SQLite.openDatabaseSync(
        `${subDirectory ?? ''}${fileNamePrefix ?? 'livestore-'}mutationlog@${liveStoreStorageFormatVersion}.db`,
      )

      const dbLogRef = { current: { db: dbLog, syncDb: makeSynchronousDatabase(dbLog) } }

      const dbLogWasEmptyWhenOpened = dbLogRef.current.syncDb.select('SELECT 1 FROM sqlite_master').length === 0

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
        insertRowPrepared({ tableName: MUTATION_LOG_META_TABLE, columns: mutationLogMetaTable.sqliteDef.columns }),
      )

      const lockStatus = SubscriptionRef.make<LockStatus>('has-lock').pipe(Effect.runSync)

      const incomingSyncMutationsQueue = yield* Queue.unbounded<PullQueueItem>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      const initialMutationEventIdSchema = mutationLogMetaTable.schema.pipe(
        Schema.pick('idGlobal', 'idLocal'),
        Schema.Array,
        Schema.headOrElse(() => ({ idGlobal: 0, idLocal: 0 })),
      )

      const initialMutationEventIdData = yield* Schema.decode(initialMutationEventIdSchema)(
        dbLogRef.current.syncDb.select(
          sql`SELECT idGlobal, idLocal FROM ${MUTATION_LOG_META_TABLE} ORDER BY idGlobal DESC, idLocal DESC LIMIT 1`,
        ),
      )

      const currentMutationEventIdRef = {
        current: {
          global: initialMutationEventIdData.idGlobal,
          local: initialMutationEventIdData.idLocal,
        },
      } as { current: EventId }

      let devtools: BootedDevtools | undefined

      const coordinator = {
        devtools: { appHostId: 'expo', enabled: false },
        lockStatus,
        // Expo doesn't support multiple client sessions, so we just use a fixed session id
        sessionId: 'expo',
        mutations: {
          pull: Stream.fromQueue(incomingSyncMutationsQueue),
          // TODO implement proper event id generation using persistent cliendId
          nextMutationEventIdPair: makeNextMutationEventIdPair(currentMutationEventIdRef),
          getCurrentMutationEventId: Effect.sync(() => currentMutationEventIdRef.current),
          push: (mutationEventEncoded, { persisted }): Effect.Effect<void, UnexpectedError> =>
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

              yield* devtools?.onMutation({ mutationEventEncoded, persisted }) ?? Effect.void
            }),
        },
        export: Effect.sync(() => dbRef.current.syncDb.export()),
        getMutationLogData: Effect.sync(() => dbLogRef.current.syncDb.export()),
        networkStatus: SubscriptionRef.make({ isConnected: false, timestampMs: Date.now() }).pipe(Effect.runSync),
      } satisfies Coordinator

      if (devtoolsEnabled) {
        devtools = yield* bootDevtools({
          connectDevtoolsToStore,
          coordinator,
          schema,
          dbRef,
          dbLogRef,
          shutdown,
          incomingSyncMutationsQueue,
        }).pipe(
          Effect.tapCauseLogPretty,
          Effect.catchAll(() => Effect.succeed(undefined)),
        )
      }

      return { syncDb: dbRef.current.syncDb, coordinator } satisfies ClientSession
    }).pipe(
      Effect.mapError((cause) => (cause._tag === 'LiveStore.UnexpectedError' ? cause : new UnexpectedError({ cause }))),
      Effect.tapCauseLogPretty,
    )
