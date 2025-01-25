import * as WT from 'node:worker_threads'

import { NodeFileSystem, NodeWorker } from '@effect/platform-node'
import {
  type Adapter,
  type Coordinator,
  Devtools,
  type LockStatus,
  type NetworkStatus,
  UnexpectedError,
} from '@livestore/common'
import type { InitialSyncOptions } from '@livestore/common/leader-thread'
import { makeNodeDevtoolsChannel } from '@livestore/devtools-node-common/web-channel'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { syncDbFactory } from '@livestore/sqlite-wasm/node'
import {
  Chunk,
  Effect,
  Fiber,
  ParseResult,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
  Worker,
  WorkerError,
} from '@livestore/utils/effect'

import * as WorkerSchema from '../worker-schema.js'

export interface NodeAdapterOptions {
  schemaPath: string
  makeSyncBackendUrl: string | undefined
  syncOptions?: WorkerSchema.SyncBackendOptions | undefined
  baseDirectory?: string
  devtools?: {
    /**
     * Where to run the devtools server (via Vite)
     *
     * @default 4242
     */
    port: number
  }
  otel?: {
    workerServiceName?: string
  }
  /** @default { _tag: 'Skip' } */
  initialSyncOptions?: InitialSyncOptions
}

export const makeNodeAdapter = ({
  schemaPath,
  makeSyncBackendUrl,
  syncOptions,
  baseDirectory,
  devtools: devtoolsOptions = { port: 4242 },
  otel: otelOptions,
  initialSyncOptions,
}: NodeAdapterOptions): Adapter =>
  (({ schema, storeId, devtoolsEnabled, shutdown, connectDevtoolsToStore }) =>
    Effect.gen(function* () {
      const networkStatus = yield* SubscriptionRef.make<NetworkStatus>({
        isConnected: true,
        timestampMs: Date.now(),
      })

      // new WT.Worker(new URL('../leader-thread.bundle.js', import.meta.url)))
      const nodeWorker = new WT.Worker(new URL('../leader-thread.js', import.meta.url), {
        // TODO make this configurable
        execArgv: process.env.DEBUG_WORKER ? ['--inspect'] : ['--enable-source-maps'],
        argv: [Schema.encodeSync(WorkerSchema.WorkerArgv)({ otel: otelOptions })],
      })

      const leaderThreadFiber = yield* Worker.makePoolSerialized<typeof WorkerSchema.LeaderWorkerInner.Request.Type>({
        size: 1,
        concurrency: 100,
        initialMessage: () =>
          new WorkerSchema.LeaderWorkerInner.InitialMessage({
            schemaPath,
            // storageOptions,
            storeId,
            originId: 'todo',
            makeSyncBackendUrl,
            syncOptions,
            baseDirectory,
            devtoolsEnabled,
            devtoolsPort: devtoolsOptions.port,
            initialSyncOptions: initialSyncOptions ?? { _tag: 'Skip' },
          }),
      }).pipe(
        Effect.provide(NodeWorker.layer(() => nodeWorker)),
        UnexpectedError.mapToUnexpectedError,
        Effect.tapErrorCause(shutdown),
        Effect.withSpan('@livestore/node:adapter:setupLeaderThread'),
        Effect.tapCauseLogPretty,
        Effect.forkScoped,
      )

      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          // We first try to gracefully shutdown the leader worker and then forcefully terminate it
          yield* Effect.raceFirst(
            runInWorker(new WorkerSchema.LeaderWorkerInner.Shutdown()).pipe(
              Effect.andThen(() => nodeWorker.terminate()),
            ),

            Effect.sync(() => {
              console.warn('[@livestore/node:adapter] Worker did not gracefully shutdown in time, terminating it')
              nodeWorker.terminate()
            }).pipe(Effect.delay(1000)),
          ).pipe(Effect.exit) // The disconnect is to prevent the interrupt to bubble out
        }).pipe(Effect.withSpan('@livestore/node:adapter:shutdown'), Effect.tapCauseLogPretty, Effect.orDie),
      )

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

      const runInWorker = <TReq extends typeof WorkerSchema.LeaderWorkerInner.Request.Type>(
        req: TReq,
      ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Effect.Effect<A, UnexpectedError, R>
        : never =>
        Fiber.join(leaderThreadFiber).pipe(
          Effect.flatMap((worker) => worker.executeEffect(req) as any),
          // NOTE we want to treat worker requests as atomic and therefore not allow them to be interrupted
          // Interruption usually only happens during leader re-election or store shutdown
          // Effect.uninterruptible,
          Effect.logWarnIfTakesLongerThan({
            label: `@livestore/node:coordinator:runInWorker:${req._tag}`,
            duration: 2000,
          }),
          Effect.withSpan(`@livestore/node:coordinator:runInWorker:${req._tag}`),
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
            Stream.withSpan(`@livestore/node:coordinator:runInWorkerStream:${req._tag}`),
          )
        }).pipe(Stream.unwrap) as any

      const initialMutationEventId = yield* runInWorker(new WorkerSchema.LeaderWorkerInner.GetCurrentMutationEventId())

      const syncInMemoryDb = yield* makeSyncDb({ _tag: 'in-memory' }).pipe(Effect.orDie)

      yield* runInWorker(new WorkerSchema.LeaderWorkerInner.Export()).pipe(
        Effect.tap((res) => syncInMemoryDb.import(res)),
        Effect.timeout(10_000),
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/node:coordinator:export'),
      )

      const appHostId = `${storeId}-${sessionId}`

      const pullMutations = runInWorkerStream(
        new WorkerSchema.LeaderWorkerInner.PullStream({ cursor: initialMutationEventId }),
      ).pipe(Stream.orDie)

      const coordinator = {
        networkStatus,
        mutations: {
          pull: pullMutations,
          push: (batch, { persisted }) =>
            runInWorker(new WorkerSchema.LeaderWorkerInner.PushToLeader({ batch })).pipe(
              // Effect.timeout(10_000),
              Effect.withSpan('@livestore/node:coordinator:push', {
                attributes: { batchSize: batch.length },
              }),
            ),
          initialMutationEventId,
        },
        export: runInWorker(new WorkerSchema.LeaderWorkerInner.Export()).pipe(
          Effect.timeout(10_000),
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/node:coordinator:export'),
        ),
        devtools: { appHostId, enabled: devtoolsEnabled },
        lockStatus,
        sessionId,
        getMutationLogData: Effect.dieMessage('Not implemented'),
        getLeaderSyncState: runInWorker(new WorkerSchema.LeaderWorkerInner.GetLeaderSyncState()).pipe(
          UnexpectedError.mapToUnexpectedError,
          Effect.withSpan('@livestore/node:coordinator:getLeaderSyncState'),
        ),
        shutdown,
      } satisfies Coordinator

      if (devtoolsEnabled) {
        yield* Effect.gen(function* () {
          const storeDevtoolsChannel = yield* makeNodeDevtoolsChannel({
            nodeName: `app-store-${appHostId}`,
            target: `devtools`,
            url: `ws://localhost:${devtoolsOptions.port}`,
            schema: { listen: Devtools.MessageToAppClientSession, send: Devtools.MessageFromAppClientSession },
          })

          // TODO handle disconnect/reconnect
          yield* connectDevtoolsToStore(storeDevtoolsChannel)
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      return { coordinator, syncDb: syncInMemoryDb }
    }).pipe(
      Effect.withSpan('@livestore/node:adapter'),
      Effect.parallelFinalizers,
      Effect.provide(NodeFileSystem.layer),
    )) satisfies Adapter
