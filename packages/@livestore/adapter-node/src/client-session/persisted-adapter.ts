import { hostname } from 'node:os'
import * as WT from 'node:worker_threads'

import type {
  Adapter,
  BootStatus,
  ClientSession,
  ClientSessionLeaderThreadProxy,
  IntentionalShutdownCause,
  LockStatus,
  NetworkStatus,
} from '@livestore/common'
import { Devtools, UnexpectedError } from '@livestore/common'
import * as DevtoolsNode from '@livestore/devtools-node-common/web-channel'
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

import { makeShutdownChannel } from '../shutdown-channel.js'
import * as WorkerSchema from '../worker-schema.js'

export interface NodeAdapterOptions {
  /**
   * Example: `new URL('./livestore.worker.js', import.meta.url)`
   */
  workerUrl: URL
  /** Needed for the worker and the devtools */
  schemaPath: string
  /** Where to store the database files */
  baseDirectory?: string
  /** The default is the hostname of the current machine */
  clientId?: string
  /** @default 'static' */
  sessionId?: string
  devtools?: {
    /**
     * Where to run the devtools server (via Vite)
     *
     * @default 4242
     */
    port: number
    /**
     * @default 'localhost'
     */
    host: string
  }
}

/**
 * Warning: This adapter doesn't currently support multiple client sessions for the same client (i.e. same storeId + clientId)
 */
export const makePersistedAdapter = ({
  workerUrl,
  schemaPath,
  baseDirectory,
  devtools: devtoolsOptions = { port: 4242, host: 'localhost' },
  clientId = hostname(),
  // TODO make this dynamic and actually support multiple sessions
  sessionId = 'static',
}: NodeAdapterOptions): Adapter =>
  (({ storeId, devtoolsEnabled, shutdown, connectDevtoolsToStore, bootStatusQueue, syncPayload }) =>
    Effect.gen(function* () {
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

      yield* shutdownChannel.listen.pipe(
        Stream.flatten(),
        Stream.tap((error) => Effect.sync(() => shutdown(Cause.fail(error)))),
        Stream.runDrain,
        Effect.interruptible,
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const syncInMemoryDb = yield* makeSqliteDb({ _tag: 'in-memory' }).pipe(Effect.orDie)

      // TODO actually implement this multi-session support
      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const { leaderThread, initialSnapshot } = yield* makeLeaderThread({
        shutdown,
        storeId,
        clientId,
        sessionId,
        workerUrl,
        baseDirectory,
        devtoolsEnabled,
        devtoolsOptions,
        schemaPath,
        bootStatusQueue,
        syncPayload,
      })

      syncInMemoryDb.import(initialSnapshot)

      if (devtoolsEnabled) {
        yield* Effect.gen(function* () {
          const webmeshNode = yield* DevtoolsNode.makeNodeDevtoolsConnectedMeshNode({
            url: `ws://${devtoolsOptions.host}:${devtoolsOptions.port}`,
            nodeName: `client-session-${storeId}-${clientId}-${sessionId}`,
          })

          const sessionsChannel = yield* webmeshNode.makeBroadcastChannel({
            channelName: 'session-info',
            schema: Devtools.SessionInfo.Message,
          })

          yield* Devtools.SessionInfo.provideSessionInfo({
            webChannel: sessionsChannel,
            sessionInfo: Devtools.SessionInfo.SessionInfo.make({ storeId, clientId, sessionId }),
          }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

          const storeDevtoolsChannel = yield* DevtoolsNode.makeChannelForConnectedMeshNode({
            node: webmeshNode,
            target: `devtools-${storeId}-${clientId}-${sessionId}`,
            schema: { listen: Devtools.ClientSession.MessageToApp, send: Devtools.ClientSession.MessageFromApp },
          })

          yield* connectDevtoolsToStore(storeDevtoolsChannel)
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      const devtools: ClientSession['devtools'] = devtoolsEnabled
        ? { enabled: true, pullLatch: yield* Effect.makeLatch(true), pushLatch: yield* Effect.makeLatch(true) }
        : { enabled: false }

      const clientSession = {
        sqliteDb: syncInMemoryDb,
        leaderThread,
        devtools,
        lockStatus,
        clientId,
        sessionId,
        shutdown,
      } satisfies ClientSession

      return clientSession
    }).pipe(
      Effect.withSpan('@livestore/adapter-node:adapter'),
      Effect.parallelFinalizers,
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Effect.provide(FetchHttpClient.layer),
    )) satisfies Adapter

const makeLeaderThread = ({
  shutdown,
  storeId,
  clientId,
  sessionId,
  workerUrl,
  baseDirectory,
  devtoolsEnabled,
  devtoolsOptions,
  schemaPath,
  bootStatusQueue,
  syncPayload,
}: {
  shutdown: (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) => void
  storeId: string
  clientId: string
  sessionId: string
  workerUrl: URL
  baseDirectory: string | undefined
  devtoolsEnabled: boolean
  devtoolsOptions: { port: number; host: string }
  schemaPath: string
  bootStatusQueue: Queue.Queue<BootStatus>
  syncPayload: Schema.JsonValue | undefined
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
          baseDirectory,
          devtools: { enabled: devtoolsEnabled, port: devtoolsOptions.port, host: devtoolsOptions.host },
          schemaPath,
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

    const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({
      isConnected: true,
      timestampMs: Date.now(),
      latchClosed: false,
    })

    const bootResult = yield* runInWorker(new WorkerSchema.LeaderWorkerInner.GetRecreateSnapshot()).pipe(
      Effect.timeout(10_000),
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/adapter-node:client-session:export'),
    )

    const leaderThread = {
      networkStatus,
      mutations: {
        pull: runInWorkerStream(new WorkerSchema.LeaderWorkerInner.PullStream({ cursor: initialLeaderHead })).pipe(
          Stream.orDie,
        ),
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
      getMutationLogData: Effect.dieMessage('Not implemented'),
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
