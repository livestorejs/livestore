import { hostname } from 'node:os'
import path from 'node:path'
import * as WT from 'node:worker_threads'
import {
  type Adapter,
  type BootStatus,
  ClientSessionLeaderThreadProxy,
  IntentionalShutdownCause,
  type LockStatus,
  type MakeSqliteDb,
  makeClientSession,
  type SyncError,
  type SyncOptions,
  UnexpectedError,
} from '@livestore/common'
import { Eventlog, LeaderThreadCtx } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { omitUndefineds } from '@livestore/utils'
import {
  Cause,
  Effect,
  Exit,
  FetchHttpClient,
  Fiber,
  FileSystem,
  Layer,
  ParseResult,
  Queue,
  Schedule,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
  Worker,
  WorkerError,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import * as Webmesh from '@livestore/webmesh'

import type { TestingOverrides } from '../leader-thread-shared.ts'
import { makeLeaderThread } from '../leader-thread-shared.ts'
import { makeShutdownChannel } from '../shutdown-channel.ts'
import * as WorkerSchema from '../worker-schema.ts'

export interface NodeAdapterOptions {
  storage: WorkerSchema.StorageType
  /** The default is the hostname of the current machine */
  clientId?: string
  /**
   * Warning: This adapter doesn't currently support multiple client sessions for the same client (i.e. same storeId + clientId)
   * @default 'static'
   */
  sessionId?: string

  /**
   * Warning: This will reset both the app and eventlog database. This should only be used during development.
   *
   * @default false
   */
  resetPersistence?: boolean

  devtools?: {
    schemaPath: string | URL
    /**
     * Where to run the devtools server (via Vite)
     *
     * @default 4242
     */
    port?: number
    /**
     * @default 'localhost'
     */
    host?: string
    /**
     * Whether to use existing devtools server
     *
     * @default false
     */
    useExistingDevtoolsServer?: boolean
  }

  /** Only used internally for testing */
  testing?: {
    overrides?: TestingOverrides
  }
}

/** Runs everything in the same thread. Use `makeWorkerAdapter` for multi-threaded implementation. */
export const makeAdapter = ({
  sync,
  ...options
}: NodeAdapterOptions & {
  sync?: SyncOptions
}): Adapter => makeAdapterImpl({ ...options, leaderThread: { _tag: 'single-threaded', sync } })

/**
 * Runs persistence and syncing in a worker thread.
 */
export const makeWorkerAdapter = ({
  workerUrl,
  workerExtraArgs,
  ...options
}: NodeAdapterOptions & {
  /**
   * Example: `new URL('./livestore.worker.ts', import.meta.url)`
   */
  workerUrl: URL
  /**
   * Extra arguments to pass to the worker which can be accessed in the worker
   * via `getWorkerArgs()`
   */
  workerExtraArgs?: Schema.JsonValue
}): Adapter => makeAdapterImpl({ ...options, leaderThread: { _tag: 'multi-threaded', workerUrl, workerExtraArgs } })

const makeAdapterImpl = ({
  storage,
  devtools: devtoolsOptionsInput,
  clientId = hostname(),
  // TODO make this dynamic and actually support multiple sessions
  sessionId = 'static',
  testing,
  resetPersistence = false,
  leaderThread: leaderThreadInput,
}: NodeAdapterOptions & {
  leaderThread:
    | {
        _tag: 'single-threaded'
        sync: SyncOptions | undefined
      }
    | {
        _tag: 'multi-threaded'
        workerUrl: URL
        workerExtraArgs: Schema.JsonValue | undefined
      }
}): Adapter =>
  ((adapterArgs) =>
    Effect.gen(function* () {
      const { storeId, devtoolsEnabled, shutdown, bootStatusQueue, syncPayloadEncoded, syncPayloadSchema, schema } =
        adapterArgs

      yield* Queue.offer(bootStatusQueue, { stage: 'loading' })

      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })

      // TODO consider bringing back happy-path initialisation boost
      // const fileData = yield* fs.readFile(dbFilePath).pipe(Effect.either)
      // if (fileData._tag === 'Right') {
      //   syncInMemoryDb.import(fileData.right)
      // } else {
      //   yield* Effect.logWarning('Failed to load database file', fileData.left)
      // }

      const shutdownChannel = yield* makeShutdownChannel(storeId)

      if (resetPersistence === true) {
        yield* shutdownChannel
          .send(IntentionalShutdownCause.make({ reason: 'adapter-reset' }))
          .pipe(UnexpectedError.mapToUnexpectedError)

        yield* resetNodePersistence({ storage, storeId })
      }

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((cause) =>
          shutdown(cause._tag === 'LiveStore.IntentionalShutdownCause' ? Exit.succeed(cause) : Exit.fail(cause)),
        ),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const syncInMemoryDb = yield* makeSqliteDb({ _tag: 'in-memory' }).pipe(Effect.orDie)

      // TODO actually implement this multi-session support
      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const devtoolsOptions: WorkerSchema.LeaderWorkerInnerInitialMessage['devtools'] =
        devtoolsEnabled && devtoolsOptionsInput !== undefined
          ? {
              enabled: true,
              schemaPath:
                typeof devtoolsOptionsInput.schemaPath === 'string'
                  ? devtoolsOptionsInput.schemaPath
                  : devtoolsOptionsInput.schemaPath.pathname,
              schemaAlias: schema.devtools.alias,
              port: devtoolsOptionsInput.port ?? 4242,
              host: devtoolsOptionsInput.host ?? 'localhost',
              useExistingDevtoolsServer: devtoolsOptionsInput.useExistingDevtoolsServer ?? false,
            }
          : { enabled: false }

      const { leaderThread, initialSnapshot } =
        leaderThreadInput._tag === 'single-threaded'
          ? yield* makeLocalLeaderThread({
              storeId,
              clientId,
              schema,
              makeSqliteDb,
              devtools: devtoolsOptions,
              storage,
              ...omitUndefineds({
                syncOptions: leaderThreadInput.sync,
                syncPayloadEncoded,
                syncPayloadSchema,
                testing,
              }),
            }).pipe(UnexpectedError.mapToUnexpectedError)
          : yield* makeWorkerLeaderThread({
              shutdown,
              storeId,
              clientId,
              sessionId,
              workerUrl: leaderThreadInput.workerUrl,
              workerExtraArgs: leaderThreadInput.workerExtraArgs,
              storage,
              devtools: devtoolsOptions,
              bootStatusQueue,
              syncPayloadEncoded,
            })

      syncInMemoryDb.import(initialSnapshot)
      syncInMemoryDb.debug.head = leaderThread.initialState.leaderHead

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDb: syncInMemoryDb,
        webmeshMode: 'proxy',
        connectWebmeshNode: Effect.fnUntraced(function* ({ webmeshNode }) {
          if (devtoolsOptions.enabled) {
            yield* Webmesh.connectViaWebSocket({
              node: webmeshNode,
              url: `ws://${devtoolsOptions.host}:${devtoolsOptions.port}`,
              openTimeout: 500,
            }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
          }
        }),
        leaderThread,
        lockStatus,
        clientId,
        sessionId,
        isLeader: true,
        // Not really applicable for node as there is no "reload the app" concept
        registerBeforeUnload: (_onBeforeUnload) => () => {},
        origin: undefined,
      })

      return clientSession
    }).pipe(
      Effect.withSpan('@livestore/adapter-node:adapter'),
      Effect.provide(Layer.mergeAll(PlatformNode.NodeFileSystem.layer, FetchHttpClient.layer)),
    )) satisfies Adapter

const resetNodePersistence = ({
  storage,
  storeId,
}: {
  storage: WorkerSchema.StorageType
  storeId: string
}): Effect.Effect<void, UnexpectedError, FileSystem.FileSystem> => {
  if (storage.type !== 'fs') {
    return Effect.void
  }

  const directory = path.join(storage.baseDirectory ?? '', storeId)

  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const directoryExists = yield* fs.exists(directory).pipe(UnexpectedError.mapToUnexpectedError)

    if (directoryExists === false) {
      return
    }

    yield* fs.remove(directory, { recursive: true }).pipe(UnexpectedError.mapToUnexpectedError)
  }).pipe(
    Effect.retry({ schedule: Schedule.exponentialBackoff10Sec }),
    Effect.withSpan('@livestore/adapter-node:resetPersistence', { attributes: { directory } }),
  )
}

const makeLocalLeaderThread = ({
  storeId,
  clientId,
  schema,
  makeSqliteDb,
  syncOptions,
  syncPayloadEncoded,
  syncPayloadSchema,
  storage,
  devtools,
  testing,
}: {
  storeId: string
  clientId: string
  schema: LiveStoreSchema
  makeSqliteDb: MakeSqliteDb
  syncOptions: SyncOptions | undefined
  storage: WorkerSchema.StorageType
  syncPayloadEncoded: Schema.JsonValue | undefined
  syncPayloadSchema: Schema.Schema<any>
  devtools: WorkerSchema.LeaderWorkerInnerInitialMessage['devtools']
  testing?: {
    overrides?: TestingOverrides
  }
}) =>
  Effect.gen(function* () {
    const layer = yield* Layer.build(
      makeLeaderThread({
        storeId,
        clientId,
        schema,
        syncOptions,
        storage,
        syncPayloadEncoded,
        syncPayloadSchema,
        devtools,
        makeSqliteDb,
        ...omitUndefineds({ testing: testing?.overrides }),
      }).pipe(Layer.unwrapScoped),
    )

    return yield* Effect.gen(function* () {
      const { dbState, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState, networkStatus } =
        yield* LeaderThreadCtx

      const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

      const leaderThread = ClientSessionLeaderThreadProxy.of(
        {
          events: {
            pull: ({ cursor }) => syncProcessor.pull({ cursor }),
            push: (batch) =>
              syncProcessor.push(
                batch.map((item) => new LiveStoreEvent.EncodedWithMeta(item)),
                { waitForProcessing: true },
              ),
          },
          initialState: { leaderHead: initialLeaderHead, migrationsReport: initialState.migrationsReport },
          export: Effect.sync(() => dbState.export()),
          getEventlogData: Effect.sync(() => dbEventlog.export()),
          syncState: syncProcessor.syncState,
          sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
          networkStatus,
        },
        { ...omitUndefineds({ overrides: testing?.overrides?.clientSession?.leaderThreadProxy }) },
      )

      const initialSnapshot = dbState.export()

      return { leaderThread, initialSnapshot }
    }).pipe(Effect.provide(layer))
  })

const makeWorkerLeaderThread = ({
  shutdown,
  storeId,
  clientId,
  sessionId,
  workerUrl,
  workerExtraArgs,
  storage,
  devtools,
  bootStatusQueue,
  syncPayloadEncoded,
  testing,
}: {
  shutdown: (cause: Exit.Exit<IntentionalShutdownCause, UnexpectedError | SyncError>) => Effect.Effect<void>
  storeId: string
  clientId: string
  sessionId: string
  workerUrl: URL
  workerExtraArgs: Schema.JsonValue | undefined
  storage: WorkerSchema.StorageType
  devtools: WorkerSchema.LeaderWorkerInnerInitialMessage['devtools']
  bootStatusQueue: Queue.Queue<BootStatus>
  syncPayloadEncoded: Schema.JsonValue | undefined
  testing?: {
    overrides?: TestingOverrides
  }
}) =>
  Effect.gen(function* () {
    const nodeWorker = new WT.Worker(workerUrl, {
      execArgv: process.env.DEBUG_WORKER ? ['--inspect --enable-source-maps'] : ['--enable-source-maps'],
      argv: [Schema.encodeSync(WorkerSchema.WorkerArgv)({ storeId, clientId, sessionId, extraArgs: workerExtraArgs })],
    })
    const nodeWorkerLayer = yield* Layer.build(PlatformNode.NodeWorker.layer(() => nodeWorker))

    const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.LeaderWorkerInnerRequest.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () =>
        new WorkerSchema.LeaderWorkerInnerInitialMessage({
          storeId,
          clientId,
          storage,
          devtools,
          syncPayloadEncoded,
        }),
    }).pipe(
      Effect.provide(nodeWorkerLayer),
      UnexpectedError.mapToUnexpectedError,
      Effect.tapErrorCause((cause) => shutdown(Exit.failCause(cause))),
      Effect.withSpan('@livestore/adapter-node:adapter:setupLeaderThread'),
    )

    const runInWorker = <TReq extends typeof WorkerSchema.LeaderWorkerInnerRequest.Type>(
      req: TReq,
    ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
      ? Effect.Effect<A, UnexpectedError, R>
      : never =>
      (worker.executeEffect(req) as any).pipe(
        Effect.logWarnIfTakesLongerThan({
          label: `@livestore/adapter-node:client-session:runInWorker:${req._tag}`,
          duration: 2000,
        }),
        Effect.withSpan(`@livestore/adapter-node:client-session:runInWorker:${req._tag}`),
        Effect.mapError((cause) =>
          Schema.is(UnexpectedError)(cause)
            ? cause
            : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
              ? new UnexpectedError({ cause })
              : cause,
        ),
        Effect.catchAllDefect((cause) => new UnexpectedError({ cause })),
      ) as any

    const runInWorkerStream = <TReq extends typeof WorkerSchema.LeaderWorkerInnerRequest.Type>(
      req: TReq,
    ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
      ? Stream.Stream<A, UnexpectedError, R>
      : never =>
      worker.execute(req as any).pipe(
        Stream.mapError((cause) =>
          Schema.is(UnexpectedError)(cause)
            ? cause
            : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
              ? new UnexpectedError({ cause })
              : cause,
        ),
        Stream.withSpan(`@livestore/adapter-node:client-session:runInWorkerStream:${req._tag}`),
      ) as any

    const bootStatusFiber = yield* runInWorkerStream(new WorkerSchema.LeaderWorkerInnerBootStatusStream()).pipe(
      Stream.tap((bootStatus) => Queue.offer(bootStatusQueue, bootStatus)),
      Stream.runDrain,
      Effect.tapErrorCause((cause) => (Cause.isInterruptedOnly(cause) ? Effect.void : shutdown(Exit.failCause(cause)))),
      Effect.interruptible,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* Queue.awaitShutdown(bootStatusQueue).pipe(
      Effect.andThen(Fiber.interrupt(bootStatusFiber)),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    const initialLeaderHead = yield* runInWorker(new WorkerSchema.LeaderWorkerInnerGetLeaderHead())

    const bootResult = yield* runInWorker(new WorkerSchema.LeaderWorkerInnerGetRecreateSnapshot()).pipe(
      Effect.timeout(10_000),
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/adapter-node:client-session:export'),
    )

    const leaderThread = ClientSessionLeaderThreadProxy.of(
      {
        events: {
          pull: ({ cursor }) =>
            runInWorkerStream(new WorkerSchema.LeaderWorkerInnerPullStream({ cursor })).pipe(Stream.orDie),
          push: (batch) =>
            runInWorker(new WorkerSchema.LeaderWorkerInnerPushToLeader({ batch })).pipe(
              Effect.withSpan('@livestore/adapter-node:client-session:pushToLeader', {
                attributes: { batchSize: batch.length },
              }),
            ),
        },
        initialState: {
          leaderHead: initialLeaderHead,
          migrationsReport: bootResult.migrationsReport,
        },
        export: runInWorker(new WorkerSchema.LeaderWorkerInnerExport()).pipe(
          Effect.timeout(10_000),
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/adapter-node:client-session:export'),
        ),
        getEventlogData: Effect.dieMessage('Not implemented'),
        syncState: Subscribable.make({
          get: runInWorker(new WorkerSchema.LeaderWorkerInnerGetLeaderSyncState()).pipe(
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/adapter-node:client-session:getLeaderSyncState'),
          ),
          changes: runInWorkerStream(new WorkerSchema.LeaderWorkerInnerSyncStateStream()).pipe(Stream.orDie),
        }),
        sendDevtoolsMessage: (message) =>
          runInWorker(new WorkerSchema.LeaderWorkerInnerExtraDevtoolsMessage({ message })).pipe(
            UnexpectedError.mapToUnexpectedError,
            Effect.withSpan('@livestore/adapter-node:client-session:devtoolsMessageForLeader'),
          ),
        networkStatus: Subscribable.make({
          get: runInWorker(new WorkerSchema.LeaderWorkerInnerGetNetworkStatus()).pipe(Effect.orDie),
          changes: runInWorkerStream(new WorkerSchema.LeaderWorkerInnerNetworkStatusStream()).pipe(Stream.orDie),
        }),
      },
      {
        ...omitUndefineds({ overrides: testing?.overrides?.clientSession?.leaderThreadProxy }),
      },
    )

    return { leaderThread, initialSnapshot: bootResult.snapshot }
  })
