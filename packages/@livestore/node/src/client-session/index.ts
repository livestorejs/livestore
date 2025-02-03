import { hostname } from 'node:os'
import * as WT from 'node:worker_threads'

import { NodeFileSystem, NodeWorker } from '@effect/platform-node'
import type {
  Adapter,
  ClientSession,
  ClientSessionLeaderThreadProxy,
  IntentionalShutdownCause,
  LockStatus,
  NetworkStatus,
} from '@livestore/common'
import { Devtools, UnexpectedError } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import { makeNodeDevtoolsChannel } from '@livestore/devtools-node-common/web-channel'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { syncDbFactory } from '@livestore/sqlite-wasm/node'
import type { Cause } from '@livestore/utils/effect'
import {
  BucketQueue,
  Effect,
  Fiber,
  ParseResult,
  Schema,
  Stream,
  SubscriptionRef,
  Worker,
  WorkerError,
} from '@livestore/utils/effect'

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
  devtools?: {
    /**
     * Where to run the devtools server (via Vite)
     *
     * @default 4242
     */
    port: number
  }
}

export const makeNodeAdapter = ({
  workerUrl,
  schemaPath,
  baseDirectory,
  devtools: devtoolsOptions = { port: 4242 },
  clientId = hostname(),
}: NodeAdapterOptions): Adapter =>
  (({ storeId, devtoolsEnabled, shutdown, connectDevtoolsToStore }) =>
    Effect.gen(function* () {
      // TODO make this dynamic and actually support multiple sessions
      const sessionId = 'static'

      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSyncDb = yield* syncDbFactory({ sqlite3 })

      // TODO consider bringing back happy-path initialisation boost
      // const fileData = yield* fs.readFile(dbFilePath).pipe(Effect.either)
      // if (fileData._tag === 'Right') {
      //   syncInMemoryDb.import(fileData.right)
      // } else {
      //   yield* Effect.logWarning('Failed to load database file', fileData.left)
      // }

      const syncInMemoryDb = yield* makeSyncDb({ _tag: 'in-memory' }).pipe(Effect.orDie)

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
      })

      syncInMemoryDb.import(initialSnapshot)

      if (devtoolsEnabled) {
        yield* Effect.gen(function* () {
          const storeDevtoolsChannel = yield* makeNodeDevtoolsChannel({
            nodeName: `client-session-${storeId}-${clientId}-${sessionId}`,
            target: `devtools`,
            url: `ws://localhost:${devtoolsOptions.port}`,
            schema: { listen: Devtools.MessageToAppClientSession, send: Devtools.MessageFromAppClientSession },
          })

          yield* connectDevtoolsToStore(storeDevtoolsChannel)
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      const devtools: ClientSession['devtools'] = devtoolsEnabled
        ? { enabled: true, pullLatch: yield* Effect.makeLatch(true), pushLatch: yield* Effect.makeLatch(true) }
        : { enabled: false }

      const clientSession = {
        syncDb: syncInMemoryDb,
        leaderThread,
        devtools,
        lockStatus,
        clientId,
        sessionId,
        shutdown,
      } satisfies ClientSession

      return clientSession
    }).pipe(
      Effect.withSpan('@livestore/node:adapter'),
      Effect.parallelFinalizers,
      Effect.provide(NodeFileSystem.layer),
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
}: {
  shutdown: (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) => Effect.Effect<void>
  storeId: string
  clientId: string
  sessionId: string
  workerUrl: URL
  baseDirectory: string | undefined
  devtoolsEnabled: boolean
  devtoolsOptions: { port: number }
  schemaPath: string
}) =>
  Effect.gen(function* () {
    const nodeWorker = new WT.Worker(workerUrl, {
      execArgv: process.env.DEBUG_WORKER ? ['--inspect --enable-source-maps'] : ['--enable-source-maps'],
      argv: [Schema.encodeSync(WorkerSchema.WorkerArgv)({ storeId, clientId, sessionId })],
    })

    const leaderThreadFiber = yield* Worker.makePoolSerialized<typeof WorkerSchema.LeaderWorkerInner.Request.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () =>
        new WorkerSchema.LeaderWorkerInner.InitialMessage({
          storeId,
          clientId,
          baseDirectory,
          devtools: { enabled: devtoolsEnabled, port: devtoolsOptions.port },
          schemaPath,
        }),
    }).pipe(
      Effect.provide(NodeWorker.layer(() => nodeWorker)),
      UnexpectedError.mapToUnexpectedError,
      Effect.tapErrorCause(shutdown),
      Effect.withSpan('@livestore/node:adapter:setupLeaderThread'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        // We first try to gracefully shutdown the leader worker and then forcefully terminate it
        yield* Effect.raceFirst(
          runInWorker(new WorkerSchema.LeaderWorkerInner.Shutdown()).pipe(Effect.andThen(() => nodeWorker.terminate())),

          Effect.sync(() => {
            console.warn('[@livestore/node:adapter] Worker did not gracefully shutdown in time, terminating it')
            nodeWorker.terminate()
          }).pipe(Effect.delay(1000)),
        ).pipe(Effect.exit) // The disconnect is to prevent the interrupt to bubble out
      }).pipe(Effect.withSpan('@livestore/node:adapter:shutdown'), Effect.tapCauseLogPretty, Effect.orDie),
    )

    const runInWorker = <TReq extends typeof WorkerSchema.LeaderWorkerInner.Request.Type>(
      req: TReq,
    ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
      ? Effect.Effect<A, UnexpectedError, R>
      : never =>
      Fiber.join(leaderThreadFiber).pipe(
        Effect.flatMap((worker) => worker.executeEffect(req) as any),
        Effect.logWarnIfTakesLongerThan({
          label: `@livestore/node:client-session:runInWorker:${req._tag}`,
          duration: 2000,
        }),
        Effect.withSpan(`@livestore/node:client-session:runInWorker:${req._tag}`),
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
      Effect.gen(function* () {
        const sharedWorker = yield* Fiber.join(leaderThreadFiber)
        return sharedWorker.execute(req as any).pipe(
          Stream.mapError((cause) =>
            Schema.is(UnexpectedError)(cause)
              ? cause
              : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
                ? new UnexpectedError({ cause })
                : cause,
          ),
          Stream.withSpan(`@livestore/node:client-session:runInWorkerStream:${req._tag}`),
        )
      }).pipe(Stream.unwrap) as any

    const initialMutationEventId = yield* runInWorker(new WorkerSchema.LeaderWorkerInner.GetCurrentMutationEventId())

    const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({
      isConnected: true,
      timestampMs: Date.now(),
    })

    const pushQueue = yield* BucketQueue.make<MutationEvent.AnyEncoded>()

    yield* Effect.gen(function* () {
      const batch = yield* BucketQueue.takeBetween(pushQueue, 1, 100)
      yield* runInWorker(new WorkerSchema.LeaderWorkerInner.PushToLeader({ batch })).pipe(
        Effect.withSpan('@livestore/node:client-session:pushToLeader', {
          attributes: { batchSize: batch.length },
        }),
      )
    }).pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)

    const leaderThread = {
      networkStatus,
      mutations: {
        pull: runInWorkerStream(new WorkerSchema.LeaderWorkerInner.PullStream({ cursor: initialMutationEventId })).pipe(
          Stream.orDie,
        ),
        // NOTE instead of sending the worker message right away, we're batching the events in order to
        // - maintain a consistent order of events
        // - improve efficiency by reducing the number of messages
        push: (batch) => BucketQueue.offerAll(pushQueue, batch),
        initialMutationEventId,
      },
      export: runInWorker(new WorkerSchema.LeaderWorkerInner.Export()).pipe(
        Effect.timeout(10_000),
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/node:client-session:export'),
      ),
      getMutationLogData: Effect.dieMessage('Not implemented'),
      getSyncState: runInWorker(new WorkerSchema.LeaderWorkerInner.GetLeaderSyncState()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/node:client-session:getLeaderSyncState'),
      ),
      sendDevtoolsMessage: (message) =>
        runInWorker(new WorkerSchema.LeaderWorkerInner.ExtraDevtoolsMessage({ message })).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/node:client-session:devtoolsMessageForLeader'),
        ),
    } satisfies ClientSessionLeaderThreadProxy

    const initialSnapshot = yield* runInWorker(new WorkerSchema.LeaderWorkerInner.Export()).pipe(
      Effect.timeout(10_000),
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/node:client-session:export'),
    )

    return { leaderThread, initialSnapshot }
  })
