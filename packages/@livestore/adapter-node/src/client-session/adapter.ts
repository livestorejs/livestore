import { hostname } from 'node:os'
import * as WT from 'node:worker_threads'

import type {
  Adapter,
  BootStatus,
  ClientSessionLeaderThreadProxy,
  IntentionalShutdownCause,
  LockStatus,
  MakeSqliteDb,
  SyncOptions,
} from '@livestore/common'
import { makeClientSession, UnexpectedError } from '@livestore/common'
import { Eventlog, LeaderThreadCtx } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import {
  Cause,
  Effect,
  FetchHttpClient,
  Fiber,
  Layer,
  ParseResult,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
  Worker,
  WorkerError,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import * as Webmesh from '@livestore/webmesh'

import type { TestingOverrides } from '../leader-thread-shared.js'
import { makeLeaderThread } from '../leader-thread-shared.js'
import { makeShutdownChannel } from '../shutdown-channel.js'
import * as WorkerSchema from '../worker-schema.js'

export interface NodeAdapterOptions {
  storage: WorkerSchema.StorageType
  /** The default is the hostname of the current machine */
  clientId?: string
  /**
   * Warning: This adapter doesn't currently support multiple client sessions for the same client (i.e. same storeId + clientId)
   * @default 'static'
   */
  sessionId?: string

  devtools?: {
    schemaPath: string
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
  ...options
}: NodeAdapterOptions & {
  /**
   * Example: `new URL('./livestore.worker.js', import.meta.url)`
   */
  workerUrl: URL
}): Adapter => makeAdapterImpl({ ...options, leaderThread: { _tag: 'multi-threaded', workerUrl } })

const makeAdapterImpl = ({
  storage,
  devtools: devtoolsOptionsInput,
  clientId = hostname(),
  // TODO make this dynamic and actually support multiple sessions
  sessionId = 'static',
  testing,
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
      }
}): Adapter =>
  ((adapterArgs) =>
    Effect.gen(function* () {
      const { storeId, devtoolsEnabled, shutdown, bootStatusQueue, syncPayload, schema } = adapterArgs

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

      if (leaderThreadInput._tag === 'multi-threaded') {
        // TODO make static import again once BroadcastChannel is stable in Deno
        //
        // const { makeShutdownChannel } = yield* Effect.promise(() => import('../shutdown-channel.js'))
        const shutdownChannel = yield* makeShutdownChannel(storeId)

        yield* shutdownChannel.listen.pipe(
          Stream.flatten(),
          Stream.tap((error) => Effect.sync(() => shutdown(Cause.fail(error)))),
          Stream.runDrain,
          Effect.interruptible,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )
      }

      const syncInMemoryDb = yield* makeSqliteDb({ _tag: 'in-memory' }).pipe(Effect.orDie)

      // TODO actually implement this multi-session support
      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const devtoolsOptions: WorkerSchema.LeaderWorkerInner.InitialMessage['devtools'] =
        devtoolsEnabled && devtoolsOptionsInput !== undefined
          ? {
              enabled: true,
              schemaPath: devtoolsOptionsInput.schemaPath,
              schemaAlias: schema.devtools.alias,
              port: devtoolsOptionsInput.port ?? 4242,
              host: devtoolsOptionsInput.host ?? 'localhost',
            }
          : { enabled: false }

      const { leaderThread, initialSnapshot } =
        leaderThreadInput._tag === 'single-threaded'
          ? yield* makeLocalLeaderThread({
              storeId,
              clientId,
              schema,
              makeSqliteDb,
              syncOptions: leaderThreadInput.sync,
              syncPayload,
              devtools: devtoolsOptions,
              storage,
              testing,
            }).pipe(UnexpectedError.mapToUnexpectedError)
          : yield* makeWorkerLeaderThread({
              shutdown,
              storeId,
              clientId,
              sessionId,
              workerUrl: leaderThreadInput.workerUrl,
              storage,
              devtools: devtoolsOptions,
              bootStatusQueue,
              syncPayload,
            })

      syncInMemoryDb.import(initialSnapshot)

      const clientSession = yield* makeClientSession({
        ...adapterArgs,
        sqliteDb: syncInMemoryDb,
        webmeshMode: 'proxy',
        connectWebmeshNode: Effect.fn(function* ({ webmeshNode }) {
          if (devtoolsOptions.enabled) {
            yield* Webmesh.connectViaWebSocket({
              node: webmeshNode,
              url: `ws://${devtoolsOptions.host}:${devtoolsOptions.port}`,
              openTimeout: 50,
            }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
          }
        }),
        leaderThread,
        lockStatus,
        clientId,
        sessionId,
        // Not really applicable for node as there is no "reload the app" concept
        registerBeforeUnload: (_onBeforeUnload) => () => {},
      })

      return clientSession
    }).pipe(
      Effect.withSpan('@livestore/adapter-node:adapter'),
      Effect.parallelFinalizers,
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Effect.provide(FetchHttpClient.layer),
    )) satisfies Adapter

const makeLocalLeaderThread = ({
  storeId,
  clientId,
  schema,
  makeSqliteDb,
  syncOptions,
  syncPayload,
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
  syncPayload: Schema.JsonValue | undefined
  devtools: WorkerSchema.LeaderWorkerInner.InitialMessage['devtools']
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
        syncPayload,
        devtools,
        makeSqliteDb,
        testing: testing?.overrides,
      }).pipe(Layer.unwrapScoped),
    )

    return yield* Effect.gen(function* () {
      const { dbState, dbEventlog, syncProcessor, extraIncomingMessagesQueue, initialState } = yield* LeaderThreadCtx

      const initialLeaderHead = Eventlog.getClientHeadFromDb(dbEventlog)

      const leaderThread = {
        events: {
          pull:
            testing?.overrides?.clientSession?.leaderThreadProxy?.events?.pull ??
            (({ cursor }) => syncProcessor.pull({ cursor })),
          push: (batch) =>
            syncProcessor.push(
              batch.map((item) => new LiveStoreEvent.EncodedWithMeta(item)),
              { waitForProcessing: true },
            ),
        },
        initialState: { leaderHead: initialLeaderHead, migrationsReport: initialState.migrationsReport },
        export: Effect.sync(() => dbState.export()),
        getEventlogData: Effect.sync(() => dbEventlog.export()),
        getSyncState: syncProcessor.syncState,
        sendDevtoolsMessage: (message) => extraIncomingMessagesQueue.offer(message),
      } satisfies ClientSessionLeaderThreadProxy

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
  storage,
  devtools,
  bootStatusQueue,
  syncPayload,
  testing,
}: {
  shutdown: (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) => void
  storeId: string
  clientId: string
  sessionId: string
  workerUrl: URL
  storage: WorkerSchema.StorageType
  devtools: WorkerSchema.LeaderWorkerInner.InitialMessage['devtools']
  bootStatusQueue: Queue.Queue<BootStatus>
  syncPayload: Schema.JsonValue | undefined
  testing?: {
    overrides?: TestingOverrides
  }
}) =>
  Effect.gen(function* () {
    const nodeWorker = new WT.Worker(workerUrl, {
      execArgv: process.env.DEBUG_WORKER ? ['--inspect --enable-source-maps'] : ['--enable-source-maps'],
      argv: [Schema.encodeSync(WorkerSchema.WorkerArgv)({ storeId, clientId, sessionId })],
    })
    const nodeWorkerLayer = yield* Layer.build(PlatformNode.NodeWorker.layer(() => nodeWorker))

    const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.LeaderWorkerInner.Request.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () =>
        new WorkerSchema.LeaderWorkerInner.InitialMessage({
          storeId,
          clientId,
          storage,
          devtools,
          syncPayload,
        }),
    }).pipe(
      Effect.provide(nodeWorkerLayer),
      UnexpectedError.mapToUnexpectedError,
      Effect.tapErrorCause((cause) => Effect.sync(() => shutdown(cause))),
      Effect.withSpan('@livestore/adapter-node:adapter:setupLeaderThread'),
    )

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        // We first try to gracefully shutdown the leader worker and then forcefully terminate it
        yield* Effect.raceFirst(
          runInWorker(new WorkerSchema.LeaderWorkerInner.Shutdown()).pipe(Effect.andThen(() => nodeWorker.terminate())),

          Effect.sync(() => {
            console.warn('[@livestore/adapter-node:adapter] Worker did not gracefully shutdown in time, terminating it')
            nodeWorker.terminate()
          }).pipe(Effect.delay(1000)),
        ).pipe(Effect.exit) // The disconnect is to prevent the interrupt to bubble out
      }).pipe(Effect.withSpan('@livestore/adapter-node:adapter:shutdown'), Effect.tapCauseLogPretty, Effect.orDie),
    )

    const runInWorker = <TReq extends typeof WorkerSchema.LeaderWorkerInner.Request.Type>(
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

    const runInWorkerStream = <TReq extends typeof WorkerSchema.LeaderWorkerInner.Request.Type>(
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

    const bootStatusFiber = yield* runInWorkerStream(new WorkerSchema.LeaderWorkerInner.BootStatusStream()).pipe(
      Stream.tap((bootStatus) => Queue.offer(bootStatusQueue, bootStatus)),
      Stream.runDrain,
      Effect.tapErrorCause((cause) =>
        Cause.isInterruptedOnly(cause) ? Effect.void : Effect.sync(() => shutdown(cause)),
      ),
      Effect.interruptible,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* Queue.awaitShutdown(bootStatusQueue).pipe(
      Effect.andThen(Fiber.interrupt(bootStatusFiber)),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    const initialLeaderHead = yield* runInWorker(new WorkerSchema.LeaderWorkerInner.GetLeaderHead())

    const bootResult = yield* runInWorker(new WorkerSchema.LeaderWorkerInner.GetRecreateSnapshot()).pipe(
      Effect.timeout(10_000),
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/adapter-node:client-session:export'),
    )

    const leaderThread = {
      events: {
        pull:
          testing?.overrides?.clientSession?.leaderThreadProxy?.events?.pull ??
          (({ cursor }) =>
            runInWorkerStream(new WorkerSchema.LeaderWorkerInner.PullStream({ cursor })).pipe(Stream.orDie)),
        push: (batch) =>
          runInWorker(new WorkerSchema.LeaderWorkerInner.PushToLeader({ batch })).pipe(
            Effect.withSpan('@livestore/adapter-node:client-session:pushToLeader', {
              attributes: { batchSize: batch.length },
            }),
          ),
      },
      initialState: {
        leaderHead: initialLeaderHead,
        migrationsReport: bootResult.migrationsReport,
      },
      export: runInWorker(new WorkerSchema.LeaderWorkerInner.Export()).pipe(
        Effect.timeout(10_000),
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:client-session:export'),
      ),
      getEventlogData: Effect.dieMessage('Not implemented'),
      getSyncState: runInWorker(new WorkerSchema.LeaderWorkerInner.GetLeaderSyncState()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:client-session:getLeaderSyncState'),
      ),
      sendDevtoolsMessage: (message) =>
        runInWorker(new WorkerSchema.LeaderWorkerInner.ExtraDevtoolsMessage({ message })).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/adapter-node:client-session:devtoolsMessageForLeader'),
        ),
    } satisfies ClientSessionLeaderThreadProxy

    return { leaderThread, initialSnapshot: bootResult.snapshot }
  })
