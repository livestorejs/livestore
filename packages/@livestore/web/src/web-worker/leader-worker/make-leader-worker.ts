import type { BootStatus, NetworkStatus, SyncBackend } from '@livestore/common'
import { makeNextMutationEventIdPair, migrateTable, ROOT_ID, sql, UnexpectedError } from '@livestore/common'
import {
  type LiveStoreSchema,
  makeMutationEventSchema,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
} from '@livestore/common/schema'
import { syncDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { isDevEnv, memoizeByStringifyArgs, shouldNeverHappen } from '@livestore/utils'
import type { HttpClient, Scope } from '@livestore/utils/effect'
import {
  BrowserWorkerRunner,
  Deferred,
  Effect,
  FetchHttpClient,
  Fiber,
  FiberSet,
  Layer,
  Logger,
  LogLevel,
  Option,
  Queue,
  Ref,
  Scheduler,
  Schema,
  Stream,
  SubscriptionRef,
  WebChannel,
  WorkerRunner,
} from '@livestore/utils/effect'

import { configureConnection } from '../../common/connection.js'
import { BCMessage } from '../../common/index.js'
import * as OpfsUtils from '../../opfs-utils.js'
import { makePersistedSqlite } from '../common/persisted-sqlite.js'
import type { ExecutionBacklogItem } from '../common/worker-schema.js'
import * as WorkerSchema from '../common/worker-schema.js'
import { makeApplyMutation } from './apply-mutation.js'
import { makeDevtoolsContext } from './leader-worker-devtools.js'
import { fetchAndApplyRemoteMutations, recreateDb } from './recreate-db.js'
import type { DevtoolsContext, InitialSetup, ShutdownState } from './types.js'
import { LeaderWorkerCtx, OuterWorkerCtx } from './types.js'

export type WorkerOptions = {
  schema: LiveStoreSchema
  makeSyncBackend?: (initProps: any) => Effect.Effect<SyncBackend<any>, UnexpectedError, Scope.Scope>
}

if (isDevEnv()) {
  globalThis.__opfsUtils = OpfsUtils
}

export const makeWorker = (options: WorkerOptions) => {
  makeWorkerRunnerOuter(options).pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(Logger.pretty),
    Effect.provide(FetchHttpClient.layer),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runFork,
  )
}

export const makeWorkerRunnerOuter = (workerOptions: WorkerOptions) =>
  WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerOuter.InitialMessage, {
    InitialMessage: ({ port: incomingRequestsPort }) =>
      Effect.gen(function* () {
        const innerFiber = yield* makeWorkerRunnerInner(workerOptions).pipe(
          Layer.provide(BrowserWorkerRunner.layerMessagePort(incomingRequestsPort)),
          Layer.launch,
          Effect.scoped,
          Effect.withSpan('@livestore/web:worker:wrapper:InitialMessage:innerFiber'),
          Effect.tapCauseLogPretty,
          Effect.annotateLogs({ thread: self.name }),
          Effect.provide(Logger.pretty),
          Logger.withMinimumLogLevel(LogLevel.Debug),
          Effect.withScheduler(Scheduler.messageChannel()),
          // We're increasing the Effect ops limit here to allow for larger chunks of operations at a time
          Effect.withMaxOpsBeforeYield(4096),
          Effect.forkScoped,
        )

        return Layer.succeed(OuterWorkerCtx, OuterWorkerCtx.of({ innerFiber }))
      }).pipe(Effect.withSpan('@livestore/web:worker:wrapper:InitialMessage'), Layer.unwrapScoped),
  })

const makeWorkerRunnerInner = ({ schema, makeSyncBackend }: WorkerOptions) =>
  Effect.gen(function* () {
    const mutationEventSchema = makeMutationEventSchema(schema)
    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    return WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerInner.Request, {
      InitialMessage: ({ storageOptions, storeId, originId, syncOptions, devtoolsEnabled }) =>
        Effect.gen(function* () {
          const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
          const makeSyncDb = syncDbFactory({ sqlite3 })

          const schemaHashSuffix = schema.migrationOptions.strategy === 'manual' ? 'fixed' : schema.hash.toString()

          const shutdownStateSubRef = yield* SubscriptionRef.make<ShutdownState>('running')

          const makeDb = makePersistedSqlite({
            storageOptions,
            kind: 'app',
            schemaHashSuffix,
            storeId,
            makeSyncDb,
            configureDb: (db) => configureConnection(db, { fkEnabled: true }),
          })

          const makeDbLog = makePersistedSqlite({
            storageOptions,
            kind: 'mutationlog',
            schemaHashSuffix,
            storeId,
            makeSyncDb,
            configureDb: (db) => configureConnection(db, { fkEnabled: false }),
          })

          // Might involve some async work, so we're running them concurrently
          const [db, dbLog] = yield* Effect.all([makeDb, makeDbLog], { concurrency: 2 })

          // TODO handle cases where options are provided but makeSyncBackend is not provided
          // TODO handle cases where makeSyncBackend is provided but options are not
          // TODO handle cases where backend and options don't match
          const syncBackend =
            syncOptions === undefined || makeSyncBackend === undefined ? undefined : yield* makeSyncBackend(syncOptions)

          if (syncBackend !== undefined) {
            const waitUntilOnline = syncBackend.isConnected.changes.pipe(
              Stream.filter(Boolean),
              Stream.take(1),
              Stream.runDrain,
            )

            // Wait first until we're online
            yield* waitUntilOnline
          }

          const broadcastChannel = yield* WebChannel.broadcastChannel({
            channelName: `livestore-sync-${schema.hash}-${storeId}`,
            listenSchema: BCMessage.Message,
            sendSchema: BCMessage.Message,
          })

          const devtools: DevtoolsContext = devtoolsEnabled ? yield* makeDevtoolsContext : { enabled: false }

          const bootStatusQueue = yield* Queue.unbounded<BootStatus>()

          const initialSetupDeferred = yield* Deferred.make<InitialSetup, UnexpectedError>()

          const mutationSemaphore = yield* Effect.makeSemaphore(1)

          const currentMutationEventIdRef = { current: ROOT_ID }
          const nextMutationEventIdPair = makeNextMutationEventIdPair(currentMutationEventIdRef)

          const leaderWorkerCtx = {
            schema,
            storeId,
            originId,
            mutationSemaphore,
            shutdownStateSubRef,
            initialSetupDeferred,
            bootStatusQueue,
            db,
            dbLog,
            mutationDefSchemaHashMap,
            mutationEventSchema,
            currentMutationEventIdRef,
            nextMutationEventIdPair,
            broadcastChannel,
            devtools,
            syncBackend,
            makeSyncDb,
          } satisfies typeof LeaderWorkerCtx.Service

          const leaderContextLayer = Layer.succeed(LeaderWorkerCtx, leaderWorkerCtx)

          yield* bootLeaderWorker.pipe(Effect.provide(leaderContextLayer), Effect.tapCauseLogPretty, Effect.forkScoped)

          return leaderContextLayer
        }).pipe(
          Effect.tapCauseLogPretty,
          UnexpectedError.mapToUnexpectedError,
          Effect.withPerformanceMeasure('@livestore/web:worker:InitialMessage'),
          Effect.withSpan('@livestore/web:worker:InitialMessage'),
          Layer.unwrapScoped,
        ),
      GetRecreateSnapshot: () =>
        Effect.gen(function* () {
          const workerCtx = yield* LeaderWorkerCtx
          const result = yield* Deferred.await(workerCtx.initialSetupDeferred)

          // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
          const cachedSnapshot =
            result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined

          return cachedSnapshot ?? workerCtx.db.export()
        }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:GetRecreateSnapshot')),
      Export: () =>
        Effect.andThen(LeaderWorkerCtx, (_) => _.db.export()).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:Export'),
        ),
      ExportMutationlog: () =>
        Effect.andThen(LeaderWorkerCtx, (_) => _.dbLog.export()).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:ExportMutationlog'),
        ),
      ExecuteBulk: ({ items }) =>
        executeBulk(items).pipe(
          Effect.uninterruptible,
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:ExecuteBulk'),
        ),
      BootStatusStream: () =>
        Effect.andThen(LeaderWorkerCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
      GetCurrentMutationEventId: () =>
        Effect.gen(function* () {
          const workerCtx = yield* LeaderWorkerCtx
          const result = workerCtx.dbLog.select<{ idGlobal: number; idLocal: number }>(
            sql`SELECT idGlobal, idLocal FROM mutation_log ORDER BY idGlobal DESC, idLocal DESC LIMIT 1`,
          )[0]

          return result ? { global: result.idGlobal, local: result.idLocal } : ROOT_ID
        }).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:GetCurrentMutationEventId'),
        ),
      NetworkStatusStream: () =>
        Effect.gen(function* (_) {
          const ctx = yield* LeaderWorkerCtx

          if (ctx.syncBackend === undefined) {
            return Stream.make<[NetworkStatus]>({ isConnected: false, timestampMs: Date.now() })
          }

          return ctx.syncBackend.isConnected.changes.pipe(
            Stream.map((isConnected) => ({ isConnected, timestampMs: Date.now() })),
          )
        }).pipe(Stream.unwrap),
      Shutdown: () =>
        Effect.gen(function* () {
          const { db, dbLog, devtools } = yield* LeaderWorkerCtx
          yield* Effect.logDebug('[@livestore/web:worker] Shutdown')

          if (devtools.enabled) {
            yield* FiberSet.clear(devtools.connections)
          }

          db.close()
          dbLog.close()
        }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:Shutdown')),
      // NOTE We're using a stream here to express a scoped effect over the worker boundary
      // so the code below can cause an interrupt on the worker client side
      ConnectDevtoolsStream: ({ port, appHostId, isLeader }) =>
        Stream.asyncScoped<{ storeMessagePort: MessagePort }, UnexpectedError, LeaderWorkerCtx | HttpClient.HttpClient>(
          (emit) =>
            Effect.gen(function* () {
              const workerCtx = yield* LeaderWorkerCtx

              if (workerCtx.devtools.enabled === false) {
                return yield* new UnexpectedError({ cause: 'Devtools are disabled' })
              }

              const storeMessagePortDeferred = yield* Deferred.make<MessagePort, UnexpectedError>()

              const fiber: Fiber.RuntimeFiber<void, UnexpectedError> = yield* workerCtx.devtools
                .connect({
                  coordinatorMessagePort: port,
                  storeMessagePortDeferred,
                  disconnect: Effect.suspend(() => Fiber.interrupt(fiber)),
                  storeId: workerCtx.storeId,
                  appHostId,
                  isLeader,
                  persistenceInfo: {
                    db: workerCtx.db.metadata.persistenceInfo,
                    mutationLog: workerCtx.dbLog.metadata.persistenceInfo,
                  },
                })
                .pipe(
                  Effect.tapError((cause) => Effect.promise(() => emit.fail(cause))),
                  Effect.onInterrupt(() => Effect.promise(() => emit.end())),
                  FiberSet.run(workerCtx.devtools.connections),
                )

              const storeMessagePort = yield* Deferred.await(storeMessagePortDeferred)

              emit.single({ storeMessagePort })
            }),
        ).pipe(Stream.withSpan('@livestore/web:worker:ConnectDevtools')),
    })
  }).pipe(Layer.unwrapScoped)

const executeBulk = (executionItems: ReadonlyArray<ExecutionBacklogItem>) =>
  Effect.gen(function* () {
    let batchItems: ExecutionBacklogItem[] = []
    const leaderWorkerCtx = yield* LeaderWorkerCtx
    const { db, dbLog, shutdownStateSubRef } = yield* LeaderWorkerCtx

    if ((yield* SubscriptionRef.get(shutdownStateSubRef)) !== 'running') {
      console.warn('livestore-webworker: shutting down, skipping execution')
      return
    }

    const createdAtMemo = memoizeByStringifyArgs(() => new Date().toISOString())
    const applyMutation = yield* makeApplyMutation(createdAtMemo, db)

    let offset = 0

    while (offset < executionItems.length) {
      try {
        db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
        dbLog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

        batchItems = executionItems.slice(offset, offset + 50)
        offset += 50

        // console.group('livestore-webworker: executing batch')
        // batchItems.forEach((_) => {
        //   if (_._tag === 'execute') {
        //     console.log(_.query, _.bindValues)
        //   } else if (_._tag === 'mutate') {
        //     console.log(_.mutationEventEncoded.mutation, _.mutationEventEncoded.id, _.mutationEventEncoded.args)
        //   }
        // })
        // console.groupEnd()

        for (const item of batchItems) {
          if (item._tag === 'execute') {
            const { query, bindValues } = item
            db.execute(query, bindValues)

            // NOTE we're not writing `execute` events to the mutation_log
          } else if (item._tag === 'mutate') {
            const mutationDef =
              leaderWorkerCtx.schema.mutations.get(item.mutationEventEncoded.mutation) ??
              shouldNeverHappen(`Unknown mutation: ${item.mutationEventEncoded.mutation}`)

            yield* applyMutation(item.mutationEventEncoded, {
              shouldBroadcast: true,
              persisted: item.persisted,
              inTransaction: true,
              syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
              syncMetadataJson: Option.none(),
            })
          } else {
            // TODO handle txn
          }
        }

        db.execute('COMMIT', undefined) // Commit the transaction
        dbLog.execute('COMMIT', undefined) // Commit the transaction
      } catch (error) {
        try {
          db.execute('ROLLBACK', undefined) // Rollback in case of an error
          dbLog.execute('ROLLBACK', undefined) // Rollback in case of an error
        } catch (e) {
          console.error('Error rolling back transaction', e)
        }

        shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
      }
    }
  })

const bootLeaderWorker = Effect.gen(function* () {
  const leaderWorkerCtx = yield* LeaderWorkerCtx
  const {
    db,
    dbLog,
    bootStatusQueue,
    initialSetupDeferred,
    currentMutationEventIdRef,
    syncBackend,
    broadcastChannel,
    schema,
  } = leaderWorkerCtx

  // @ts-expect-error For debugging purposes
  globalThis.__leaderWorkerCtx = leaderWorkerCtx

  yield* migrateTable({
    db: dbLog,
    behaviour: 'create-if-not-exists',
    tableAst: mutationLogMetaTable.sqliteDef.ast,
    skipMetaTable: true,
  })

  // TODO do more validation here
  const needsRecreate = db.select<{ count: number }>(sql`select count(*) as count from sqlite_master`)[0]!.count === 0

  const initializeCurrentMutationEventId = Effect.gen(function* () {
    const initialMutationEventId = dbLog.select<{ idGlobal: number; idLocal: number }>(
      sql`select idGlobal, idLocal from ${MUTATION_LOG_META_TABLE} order by idGlobal DESC, idLocal DESC limit 1`,
    )[0]

    if (initialMutationEventId !== undefined) {
      currentMutationEventIdRef.current = {
        global: initialMutationEventId.idGlobal,
        local: initialMutationEventId.idLocal,
      }
    }
  })

  if (needsRecreate) {
    yield* recreateDb.pipe(
      Effect.tap(({ snapshot, syncInfo }) =>
        Effect.gen(function* () {
          yield* Queue.offer(bootStatusQueue, { stage: 'done' })
          const snapshotRef = yield* Ref.make<Uint8Array | undefined>(snapshot)
          yield* Deferred.succeed(initialSetupDeferred, { _tag: 'Recreate', snapshotRef, syncInfo })
        }),
      ),
      UnexpectedError.mapToUnexpectedError,
      // NOTE we don't need to log the error here as we log it on the `await` side
      Effect.tapError((cause) => Deferred.fail(initialSetupDeferred, cause)),
      Effect.forkScoped,
    )

    yield* initializeCurrentMutationEventId
  } else {
    yield* initializeCurrentMutationEventId

    yield* fetchAndApplyRemoteMutations(db, true, ({ done, total }) =>
      Queue.offer(bootStatusQueue, { stage: 'syncing', progress: { done, total } }),
    ).pipe(
      Effect.tap((syncInfo) =>
        Effect.gen(function* () {
          yield* Queue.offer(bootStatusQueue, { stage: 'done' })
          yield* Deferred.succeed(initialSetupDeferred, { _tag: 'Reuse', syncInfo })
        }),
      ),
      UnexpectedError.mapToUnexpectedError,
      // NOTE we don't need to log the error here as we log it on the `await` side
      Effect.tapError((cause) => Deferred.fail(initialSetupDeferred, cause)),
      Effect.forkScoped,
    )
  }

  const { syncInfo } = yield* Deferred.await(initialSetupDeferred)

  const applyMutation = yield* makeApplyMutation(() => new Date().toISOString(), db)

  if (syncBackend !== undefined) {
    // TODO try to do this in a batched-way if possible
    yield* syncBackend.pull(syncInfo, { listenForNew: true }).pipe(
      // Filter out "own" mutations
      // Stream.filter((_) => _.mutationEventEncoded.id.startsWith(originId) === false),
      Stream.tap(({ mutationEventEncoded, persisted, metadata }) =>
        Effect.gen(function* () {
          // NOTE this is a temporary workaround until rebase-syncing is implemented
          if (mutationEventEncoded.id.global <= currentMutationEventIdRef.current.global) {
            return
          }

          // TODO handle rebasing
          // if incoming mutation parent id !== current mutation event id, we need to rebase
          yield* applyMutation(mutationEventEncoded, {
            syncStatus: 'synced',
            shouldBroadcast: true,
            persisted,
            inTransaction: false,
            syncMetadataJson: metadata,
          })
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('@livestore/web:worker:syncBackend:pushes'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )
  }

  yield* broadcastChannel.listen.pipe(
    Stream.flatten(),
    Stream.filter(({ sender }) => sender === 'follower-thread'),
    Stream.tap(({ mutationEventEncoded, persisted }) =>
      Effect.gen(function* () {
        const mutationDef =
          schema.mutations.get(mutationEventEncoded.mutation) ??
          shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

        yield* applyMutation(mutationEventEncoded, {
          syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
          shouldBroadcast: true,
          persisted,
          inTransaction: false,
          syncMetadataJson: Option.none(),
        })
      }).pipe(Effect.withSpan('@livestore/web:worker:broadcastChannel:message')),
    ),
    Stream.runDrain,
    Effect.tapCauseLogPretty,
    Effect.forkScoped,
  )
})
