import './thread-polyfill.js'

import inspector from 'node:inspector'
import path from 'node:path'

if (process.execArgv.includes('--inspect')) {
  inspector.open()
  inspector.waitForDebugger()
}

import { NodeFileSystem, NodeWorkerRunner } from '@effect/platform-node'
import type { NetworkStatus } from '@livestore/common'
import { Devtools, ROOT_ID, sql, UnexpectedError } from '@livestore/common'
import type { DevtoolsContext, PullQueueItem } from '@livestore/common/leader-thread'
import {
  configureConnection,
  LeaderThreadCtx,
  makeApplyMutation,
  makeDevtoolsContext,
  makeLeaderThread,
} from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { makeNodeDevtoolsChannel } from '@livestore/devtools-node-common/web-channel'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { syncDbFactory } from '@livestore/sqlite-wasm/node'
import { memoizeByStringifyArgs, shouldNeverHappen } from '@livestore/utils'
import type { FileSystem, HttpClient, Scope } from '@livestore/utils/effect'
import {
  Effect,
  FetchHttpClient,
  Fiber,
  FiberSet,
  Layer,
  Logger,
  LogLevel,
  Option,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
  WorkerRunner,
} from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'

import { startDevtoolsServer } from './devtools/devtools-server.js'
import { makeShutdownChannel } from './shutdown-channel.js'
import type { ExecutionBacklogItem } from './worker-schema.js'
import * as WorkerSchema from './worker-schema.js'

const argvOptions = Schema.decodeSync(WorkerSchema.WorkerArgv)(process.argv[2]!)

WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerInner.Request, {
  InitialMessage: (args) => makeLeaderThreadLayer(args),
  ExecuteBulk: ({ items }) =>
    executeBulk(items).pipe(
      Effect.uninterruptible,
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/node:worker:ExecuteBulk'),
    ),
  BootStatusStream: () =>
    Effect.andThen(LeaderThreadCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
  PullStream: () =>
    Effect.gen(function* () {
      const workerCtx = yield* LeaderThreadCtx
      const pullQueue = yield* Queue.unbounded<PullQueueItem>().pipe(Effect.acquireRelease(Queue.shutdown))

      workerCtx.connectedClientSessionPullQueues.add(pullQueue)

      yield* Effect.addFinalizer(() => Effect.sync(() => workerCtx.connectedClientSessionPullQueues.delete(pullQueue)))

      return Stream.fromQueue(pullQueue)
    }).pipe(Stream.unwrapScoped),
  Export: () =>
    Effect.andThen(LeaderThreadCtx, (_) => _.db.export()).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/node:worker:Export'),
    ),
  ExportMutationlog: () =>
    Effect.andThen(LeaderThreadCtx, (_) => _.dbLog.export()).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/node:worker:ExportMutationlog'),
    ),
  GetCurrentMutationEventId: () =>
    Effect.gen(function* () {
      const workerCtx = yield* LeaderThreadCtx
      const result = workerCtx.dbLog.select<{ idGlobal: number; idLocal: number }>(
        sql`SELECT idGlobal, idLocal FROM mutation_log ORDER BY idGlobal DESC, idLocal DESC LIMIT 1`,
      )[0]

      return result ? { global: result.idGlobal, local: result.idLocal } : ROOT_ID
    }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:GetCurrentMutationEventId')),
  NetworkStatusStream: () =>
    Effect.gen(function* (_) {
      const ctx = yield* LeaderThreadCtx

      if (ctx.syncBackend === undefined) {
        return Stream.make<[NetworkStatus]>({ isConnected: false, timestampMs: Date.now() })
      }

      return ctx.syncBackend.isConnected.changes.pipe(
        Stream.map((isConnected) => ({ isConnected, timestampMs: Date.now() })),
      )
    }).pipe(Stream.unwrap),
  // GetRecreateSnapshot: () =>
  //   Effect.gen(function* () {
  //     const workerCtx = yield* LeaderThreadCtx
  //     const result = yield* Deferred.await(workerCtx.initialSetupDeferred)

  //     // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
  //     const cachedSnapshot =
  //       result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined

  //     return cachedSnapshot ?? workerCtx.db.export()
  //   }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:GetRecreateSnapshot')),
  Shutdown: () =>
    Effect.gen(function* () {
      const { db, dbLog, devtools } = yield* LeaderThreadCtx
      yield* Effect.logDebug('[@livestore/web:worker] Shutdown')

      if (devtools.enabled) {
        yield* FiberSet.clear(devtools.connections)
      }

      db.close()
      dbLog.close()
    }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:Shutdown')),
}).pipe(
  Layer.provide(NodeWorkerRunner.layer),
  Layer.launch,
  Effect.scoped,
  Effect.tapCauseLogPretty,
  Effect.annotateLogs({ thread: argvOptions.otel?.workerServiceName ?? 'livestore-node-leader-thread' }),
  Effect.provide(Logger.pretty),
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(NodeFileSystem.layer),
  Effect.provide(
    OtelLiveHttp({
      serviceName: argvOptions.otel?.workerServiceName ?? 'livestore-node-leader-thread',
      skipLogUrl: true,
    }),
  ),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  Effect.runFork,
)

const makeLeaderThreadLayer = ({
  schemaPath,
  storeId,
  originId,
  syncOptions,
  makeSyncBackendUrl,
  baseDirectory,
  devtoolsEnabled,
  devtoolsPort,
  initialSyncOptions,
}: WorkerSchema.LeaderWorkerInner.InitialMessage): Layer.Layer<
  LeaderThreadCtx,
  UnexpectedError,
  Scope.Scope | HttpClient.HttpClient | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const schema = yield* Effect.promise(() => import(schemaPath).then((m) => m.schema as LiveStoreSchema))
    const makeSyncBackend = makeSyncBackendUrl
      ? yield* Effect.promise(() => import(makeSyncBackendUrl).then((m) => m.makeWsSync))
      : undefined

    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
      Effect.withSpan('@livestore/node:leader-thread:loadSqlite3Wasm'),
    )
    const makeSyncDb = yield* syncDbFactory({ sqlite3 })

    const schemaHashSuffix = schema.migrationOptions.strategy === 'manual' ? 'fixed' : schema.hash.toString()

    const makeDb = (kind: 'app' | 'mutationlog') =>
      makeSyncDb({
        _tag: 'fs',
        directory: path.join(baseDirectory ?? '', storeId),
        fileName: kind === 'app' ? getAppDbFileName(schemaHashSuffix) : 'mutationlog.db',
        // TODO enable WAL for nodejs
        configureDb: (db) => configureConnection(db, { fkEnabled: true }),
      }).pipe(Effect.acquireRelease((db) => Effect.sync(() => db.close())))

    // Might involve some async work, so we're running them concurrently
    const [db, dbLog] = yield* Effect.all([makeDb('app'), makeDb('mutationlog')], { concurrency: 2 })

    const devtools: DevtoolsContext = devtoolsEnabled ? yield* makeDevtoolsContext : { enabled: false }

    const leaderThreadLayer = makeLeaderThread({
      schema,
      storeId,
      originId,
      makeSyncDb,
      makeSyncBackend: makeSyncBackend === undefined ? undefined : makeSyncBackend(syncOptions),
      db,
      dbLog,
      devtoolsEnabled,
      initialSyncOptions,
    })

    if (devtools.enabled === true) {
      yield* bootDevtools({ devtoolsPort, schemaPath }).pipe(
        Effect.provide(leaderThreadLayer),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )
    }

    return leaderThreadLayer
  }).pipe(
    Effect.tapCauseLogPretty,
    UnexpectedError.mapToUnexpectedError,
    Effect.withSpan('@livestore/node:worker:InitialMessage'),
    Layer.unwrapScoped,
  )

const getAppDbFileName = (suffix: string) => `app${suffix}.db`

const executeBulk = (executionItems: ReadonlyArray<ExecutionBacklogItem>) =>
  Effect.gen(function* () {
    let batchItems: ExecutionBacklogItem[] = []
    const leaderThreadCtx = yield* LeaderThreadCtx
    const { db, dbLog, shutdownStateSubRef } = yield* LeaderThreadCtx

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
          // TODO get rid of this in favour of raw sql mutations
          if (item._tag === 'execute') {
            const { query, bindValues } = item
            db.execute(query, bindValues)

            // NOTE we're not writing `execute` events to the mutation_log
          } else if (item._tag === 'mutate') {
            const mutationDef =
              leaderThreadCtx.schema.mutations.get(item.mutationEventEncoded.mutation) ??
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

const bootDevtools = ({ schemaPath, devtoolsPort }: { schemaPath: string; devtoolsPort: number }) =>
  Effect.gen(function* () {
    const { storeId, db, dbLog, devtools } = yield* LeaderThreadCtx

    if (devtools.enabled === false) {
      return
    }

    const shutdownChannel = yield* makeShutdownChannel(storeId)

    yield* startDevtoolsServer({ schemaPath, storeId, port: devtoolsPort }).pipe(
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    // TODO make this dynamic once we want to support multiple node instances
    // (probably via RPC call from coordinator)
    const sessionId = 'static'
    const appHostId = `${storeId}-${sessionId}`
    const isLeader = true

    const coordinatorToDevtoolsChannel = yield* makeNodeDevtoolsChannel({
      nodeName: `app-coordinator-${appHostId}`,
      target: 'devtools',
      url: `ws://localhost:${devtoolsPort}`,
      schema: { listen: Devtools.MessageToAppHostCoordinator, send: Devtools.MessageFromAppHostCoordinator },
    })

    // TODO disconnect/reconnect based on channel status
    const fiber: Fiber.RuntimeFiber<void, UnexpectedError> = yield* devtools
      .connect({
        coordinatorMessagePortOrChannel: coordinatorToDevtoolsChannel,
        // storeMessagePortDeferred,
        disconnect: Effect.suspend(() => Fiber.interrupt(fiber)),
        storeId,
        appHostId,
        isLeader,
        persistenceInfo: {
          db: db.metadata.persistenceInfo,
          mutationLog: dbLog.metadata.persistenceInfo,
        },
        shutdownChannel,
      })
      .pipe(
        // TODO handle errors
        FiberSet.run(devtools.connections),
      )
  })
