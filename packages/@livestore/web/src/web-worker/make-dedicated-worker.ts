import { makeWsSync } from '@livestore/cf-sync/sync-impl'
import type { BootStatus, NetworkStatus } from '@livestore/common'
import { Devtools, liveStoreVersion, sql, UnexpectedError } from '@livestore/common'
import { type LiveStoreSchema, makeMutationEventSchema, MUTATION_LOG_META_TABLE } from '@livestore/common/schema'
import { memoizeByStringifyArgs, shouldNeverHappen } from '@livestore/utils'
import type { Context } from '@livestore/utils/effect'
import {
  BrowserWorkerRunner,
  Deferred,
  Effect,
  Exit,
  Layer,
  Logger,
  LogLevel,
  Queue,
  Runtime,
  Scheduler,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  WorkerRunner,
} from '@livestore/utils/effect'

import { BCMessage } from '../common/index.js'
import * as OpfsUtils from '../opfs-utils.js'
import { loadSqlite3Wasm } from '../sqlite-utils.js'
import type { DevtoolsContext, InitialSetup, ShutdownState } from './common.js'
import { configureConnection, InnerWorkerCtx, makeApplyMutation, OuterWorkerCtx } from './common.js'
import { makeDevtoolsContext } from './devtools.js'
import { makePersistedSqlite } from './persisted-sqlite.js'
import { fetchAndApplyRemoteMutations, recreateDb } from './recreate-db.js'
import type { ExecutionBacklogItem } from './schema.js'
import * as WorkerSchema from './schema.js'

export type WorkerOptions = {
  schema: LiveStoreSchema
}

// @ts-expect-error TODO fix types
if (import.meta.env.DEV) {
  // @ts-expect-error TODO fix types
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
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runFork,
  )
}

export const makeWorkerRunnerOuter = ({ schema }: WorkerOptions) =>
  WorkerRunner.layerSerialized(WorkerSchema.DedicatedWorkerOuter.InitialMessage, {
    InitialMessage: ({ port: incomingRequestsPort }) =>
      Effect.gen(function* () {
        const innerFiber = yield* makeWorkerRunner({ schema }).pipe(
          Layer.provide(BrowserWorkerRunner.layerMessagePort(incomingRequestsPort)),
          Layer.launch,
          Effect.scoped,
          Effect.withSpan('@livestore/web:worker:wrapper:InitialMessage:innerFiber'),
          Effect.tapCauseLogPretty,
          Effect.annotateLogs({ thread: self.name }),
          Effect.provide(Logger.pretty),
          Logger.withMinimumLogLevel(LogLevel.Debug),
          Effect.withScheduler(Scheduler.messageChannel()),
          Effect.withMaxOpsBeforeYield(4096),
          Effect.forkScoped,
        )

        return Layer.succeed(OuterWorkerCtx, OuterWorkerCtx.of({ innerFiber }))
      }).pipe(Effect.withSpan('@livestore/web:worker:wrapper:InitialMessage'), Layer.unwrapScoped),
  })

const makeWorkerRunner = ({ schema }: WorkerOptions) =>
  Effect.gen(function* () {
    const mutationEventSchema = makeMutationEventSchema(schema)
    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    const schemaHash = schema.hash

    return WorkerRunner.layerSerialized(WorkerSchema.DedicatedWorkerInner.Request, {
      InitialMessage: ({
        storageOptions,
        needsRecreate,
        syncOptions,
        key,
        devtools: { channelId, enabled: devtoolsEnabled },
      }) =>
        Effect.gen(function* () {
          if (storageOptions.type === 'opfs-sahpool-experimental') {
            // NOTE We're not using SharedArrayBuffers/Atomics here, so we can ignore the warnings
            // See https://sqlite.org/forum/info/9d4f722c6912799d
            // TODO hopefully this won't be needed in future versions of SQLite where when using SAHPool, SQLite
            // won't attempt to spawn the async OPFS proxy
            // See https://sqlite.org/forum/info/9d4f722c6912799d and https://github.com/sqlite/sqlite-wasm/issues/62
            // @ts-expect-error Missing types
            globalThis.sqlite3ApiConfig = {
              warn: () => {},
            }
          }
          const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())

          const keySuffix = key ? `-${key}` : ''

          const shutdownStateSubRef = yield* SubscriptionRef.make<ShutdownState>('running')

          let sahUtils: Awaited<ReturnType<typeof sqlite3.installOpfsSAHPoolVfs>> | undefined
          if (storageOptions.type === 'opfs-sahpool-experimental') {
            sahUtils = yield* Effect.tryPromise(() =>
              sqlite3.installOpfsSAHPoolVfs({ directory: storageOptions.directory }),
            )
          }

          const makeDb = makePersistedSqlite({
            storageOptions,
            kind: 'app',
            schemaHash,
            sqlite3,
            sahUtils,
            configure: (db) => Effect.sync(() => configureConnection(db, { fkEnabled: true })),
          })

          const makeDbLog = makePersistedSqlite({
            storageOptions,
            kind: 'mutationlog',
            schemaHash,
            sqlite3,
            sahUtils,
            configure: (db) => Effect.sync(() => configureConnection(db, { fkEnabled: false })),
          })

          // Might involve some async work, so we're running them concurrently
          const [db, dbLog] = yield* Effect.all([makeDb, makeDbLog], { concurrency: 2 })

          const cursor = yield* Effect.try(
            () =>
              dbLog.dbRef.current.selectValue(
                sql`SELECT id FROM ${MUTATION_LOG_META_TABLE} WHERE syncStatus = 'synced' ORDER BY id DESC LIMIT 1`,
              ) as string | undefined,
          ).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

          const syncImpl =
            syncOptions === undefined ? undefined : yield* makeWsSync(syncOptions.url, syncOptions.roomId)

          const broadcastChannel = new BroadcastChannel(`livestore-sync-${schemaHash}${keySuffix}`)

          const makeSync = Effect.gen(function* () {
            if (syncImpl === undefined) return undefined

            const waitUntilOnline = SubscriptionRef.changeStreamIncludingCurrent(syncImpl.isConnected).pipe(
              Stream.filter(Boolean),
              Stream.take(1),
              Stream.runDrain,
            )

            // Wait first until we're online
            yield* waitUntilOnline

            return {
              impl: syncImpl,
              inititialMessages: syncImpl.pull(cursor),
            }
          })

          const sync = yield* makeSync

          const devtools: DevtoolsContext = devtoolsEnabled ? yield* makeDevtoolsContext(channelId) : { enabled: false }

          const bootStatusQueue = yield* Queue.unbounded<BootStatus>()

          const initialSetupDeferred = yield* Deferred.make<InitialSetup>()

          const innerWorkerCtx = {
            keySuffix,
            storageOptions,
            schema,
            shutdownStateSubRef,
            sqlite3,
            initialSetupDeferred,
            bootStatusQueue,
            db,
            dbLog,
            mutationDefSchemaHashMap,
            mutationEventSchema,
            broadcastChannel,
            devtools,
            sync,
          } satisfies Context.Tag.Service<InnerWorkerCtx>

          // @ts-expect-error For debugging purposes
          globalThis.__innerWorkerCtx = innerWorkerCtx

          if (needsRecreate) {
            yield* recreateDb(innerWorkerCtx).pipe(
              Effect.tap(() => Queue.offer(bootStatusQueue, { stage: 'done' })),
              Effect.tap((snapshot) => Deferred.succeed(initialSetupDeferred, { _tag: 'Recreate', snapshot })),
              Effect.tapCauseLogPretty,
              Effect.forkScoped,
            )
          } else {
            yield* fetchAndApplyRemoteMutations(innerWorkerCtx, db.dbRef.current, true, ({ done, total }) =>
              Queue.offer(bootStatusQueue, { stage: 'syncing', progress: { done, total } }),
            ).pipe(
              Effect.tap(() => Queue.offer(bootStatusQueue, { stage: 'done' })),
              Effect.tap(() => Deferred.succeed(initialSetupDeferred, { _tag: 'Reuse' })),
              Effect.tapCauseLogPretty,
              Effect.forkScoped,
            )
          }

          yield* Effect.gen(function* () {
            yield* Deferred.await(initialSetupDeferred)

            const applyMutation = makeApplyMutation(innerWorkerCtx, () => new Date().toISOString(), db.dbRef.current)

            if (syncImpl !== undefined) {
              // TODO try to do this in a batched-way if possible
              yield* syncImpl.pushes.pipe(
                Stream.tap(({ mutationEventEncoded, persisted }) =>
                  applyMutation(mutationEventEncoded, { syncStatus: 'synced', shouldBroadcast: true, persisted }),
                ),
                Stream.runDrain,
                Effect.withSpan('@livestore/web:worker:syncImpl:pushes'),
                Effect.tapCauseLogPretty,
                Effect.forkScoped,
              )
            }

            const runtime = yield* Effect.runtime<never>()

            broadcastChannel.addEventListener('message', (event) =>
              Effect.gen(function* () {
                const { sender, mutationEventEncoded, persisted } = Schema.decodeUnknownSync(BCMessage.Message)(
                  event.data,
                )
                // console.log('[@livestore/web:worker] broadcastChannel message', event.data)
                if (sender === 'ui-thread') {
                  // console.log('livestore-webworker: applying mutation from ui-thread', mutationEventEncoded)

                  const mutationDef =
                    schema.mutations.get(mutationEventEncoded.mutation) ??
                    shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

                  yield* applyMutation(mutationEventEncoded, {
                    syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
                    shouldBroadcast: true,
                    persisted,
                  })
                }
              }).pipe(
                Effect.withSpan('@livestore/web:worker:broadcastChannel:message'),
                Effect.tapCauseLogPretty,
                Runtime.runFork(runtime),
              ),
            )
          }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

          return Layer.succeed(InnerWorkerCtx, innerWorkerCtx)
        }).pipe(
          Effect.tapCauseLogPretty,
          UnexpectedError.mapToUnexpectedError,
          Effect.withPerformanceMeasure('@livestore/web:worker:InitialMessage'),
          Effect.withSpan('@livestore/web:worker:InitialMessage'),
          Layer.unwrapScoped,
        ),
      GetRecreateSnapshot: () =>
        Effect.gen(function* () {
          const workerCtx = yield* InnerWorkerCtx
          const result = yield* Deferred.await(workerCtx.initialSetupDeferred)

          if (result._tag === 'Recreate') {
            return result.snapshot
          } else {
            return yield* workerCtx.db.export
          }
        }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:GetRecreateSnapshot')),
      Export: () =>
        Effect.andThen(InnerWorkerCtx, (_) => _.db.export).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:Export'),
        ),
      ExportMutationlog: () =>
        Effect.andThen(InnerWorkerCtx, (_) => _.dbLog.export).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:ExportMutationlog'),
        ),
      ExecuteBulk: ({ items }) =>
        executeBulk(items).pipe(
          Effect.uninterruptible,
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:ExecuteBulk'),
        ),
      // BootStatusStream: () =>
      //   Effect.andThen(InnerWorkerCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
      BootStatusStream: () => {
        performance.mark('bootStatusStartBeforeCtx')
        return Effect.andThen(InnerWorkerCtx, (_) => {
          performance.mark('bootStatusStart')
          return Stream.fromQueue(_.bootStatusQueue)
        }).pipe(
          Stream.unwrap,
          Stream.tapSync(() => performance.mark('bootStatusUpdate')),
        )
      },
      NetworkStatusStream: () =>
        Effect.gen(function* (_) {
          const ctx = yield* InnerWorkerCtx

          if (ctx.sync === undefined) {
            return Stream.make<[NetworkStatus]>({ isConnected: false, timestampMs: Date.now() })
          }

          return ctx.sync.impl.isConnected.changes.pipe(
            Stream.map((isConnected) => ({ isConnected, timestampMs: Date.now() })),
            Stream.tap((networkStatus) =>
              ctx.devtools.enabled
                ? ctx.devtools.broadcast(
                    Devtools.NetworkStatusChanged.make({
                      channelId: ctx.devtools.channelId,
                      networkStatus,
                      liveStoreVersion,
                    }),
                  )
                : Effect.void,
            ),
          )
        }).pipe(Stream.unwrap),
      ListenForReloadStream: () =>
        InnerWorkerCtx.pipe(
          Effect.andThen((_) => SubscriptionRef.waitUntil(_.shutdownStateSubRef, (_) => _ == 'shutdown-requested')),
          Effect.tapSync((_) => console.log('[@livestore/web:worker] ListenForReload: shutdown-requested')),
          Effect.asVoid,
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/web:worker:ListenForReload'),
        ),
      Shutdown: () =>
        Effect.gen(function* () {
          // TODO get rid of explicit close calls and rely on the finalizers (by dropping the scope from `InitialMessage`)
          const { db, dbLog, devtools } = yield* InnerWorkerCtx

          if (devtools.enabled) {
            yield* Effect.forEach(devtools.connectionScopes, (scope) => Scope.close(scope, Exit.void))
          }

          db.dbRef.current.close()
          dbLog.dbRef.current.close()
          yield* db.close
          yield* dbLog.close
        }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:Shutdown')),
      ConnectDevtools: ({ port, connectionId, isLeaderTab }) =>
        Effect.gen(function* () {
          const workerCtx = yield* InnerWorkerCtx

          if (workerCtx.devtools.enabled === false) {
            return yield* new UnexpectedError({ cause: 'Devtools are disabled' })
          }

          const storeMessagePortDeferred = yield* Deferred.make<MessagePort>()
          const connectionScope = yield* Scope.make()

          yield* workerCtx.devtools
            .connect({
              coordinatorMessagePort: port,
              storeMessagePortDeferred,
              connectionScope,
              connectionId,
              isLeaderTab,
            })
            .pipe(Effect.tapCauseLogPretty, Effect.forkIn(connectionScope))

          const storeMessagePort = yield* Deferred.await(storeMessagePortDeferred)

          return { storeMessagePort }
        }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:ConnectDevtools')),
    })
  }).pipe(Layer.unwrapScoped)

const executeBulk = (executionItems: ReadonlyArray<ExecutionBacklogItem>) =>
  Effect.gen(function* () {
    let batchItems: ExecutionBacklogItem[] = []
    const workerCtx = yield* InnerWorkerCtx
    const { db, dbLog, shutdownStateSubRef } = yield* InnerWorkerCtx

    if ((yield* SubscriptionRef.get(shutdownStateSubRef)) !== 'running') {
      console.warn('livestore-webworker: shutting down, skipping execution')
      return
    }

    const createdAtMemo = memoizeByStringifyArgs(() => new Date().toISOString())
    const applyMutation = makeApplyMutation(workerCtx, createdAtMemo, db.dbRef.current)

    let offset = 0

    while (offset < executionItems.length) {
      try {
        db.dbRef.current.exec('BEGIN TRANSACTION') // Start the transaction
        dbLog.dbRef.current.exec('BEGIN TRANSACTION') // Start the transaction

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
            db.dbRef.current.exec({ sql: query, bind: bindValues })

            // NOTE we're not writing `execute` events to the mutation_log
          } else if (item._tag === 'mutate') {
            const mutationDef =
              workerCtx.schema.mutations.get(item.mutationEventEncoded.mutation) ??
              shouldNeverHappen(`Unknown mutation: ${item.mutationEventEncoded.mutation}`)

            yield* applyMutation(item.mutationEventEncoded, {
              syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
              shouldBroadcast: true,
              persisted: item.persisted,
            })
          } else {
            // TODO handle txn
          }
        }

        db.dbRef.current.exec('COMMIT') // Commit the transaction
        dbLog.dbRef.current.exec('COMMIT') // Commit the transaction
      } catch (error) {
        try {
          db.dbRef.current.exec('ROLLBACK') // Rollback in case of an error
          dbLog.dbRef.current.exec('ROLLBACK') // Rollback in case of an error
        } catch (e) {
          console.error('Error rolling back transaction', e)
        }

        shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
      }
    }
  })
