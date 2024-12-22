import * as WT from 'node:worker_threads'

import { NodeFileSystem, NodeWorker } from '@effect/platform-node'
import {
  type Adapter,
  type Coordinator,
  Devtools,
  type LockStatus,
  makeNextMutationEventIdPair,
  type NetworkStatus,
  UnexpectedError,
} from '@livestore/common'
import type { InitialSyncOptions } from '@livestore/common/leader-thread'
import { validateAndUpdateMutationEventId } from '@livestore/common/leader-thread'
import { makeMutationEventSchema } from '@livestore/common/schema'
import { makeNodeDevtoolsChannel } from '@livestore/devtools-node-common/web-channel'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { syncDbFactory } from '@livestore/sqlite-wasm/node'
import { Chunk, Effect, Fiber, Queue, Schema, Stream, SubscriptionRef, Worker } from '@livestore/utils/effect'

import * as WorkerSchema from '../worker-schema.js'

export interface NodeAdapterOptions {
  schemaPath: string
  makeSyncBackendUrl: string | undefined
  syncOptions?: WorkerSchema.SyncBackendOptions | undefined
  baseDirectory?: string
  devtools?: {
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
  devtools: devtoolsOptions = {
    port: 4242,
  },
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
      const mutationEventSchema = makeMutationEventSchema(schema)

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
          UnexpectedError.mapToUnexpectedError,
        ) as any

      const runInWorkerStream = <TReq extends typeof WorkerSchema.LeaderWorkerInner.Request.Type>(
        req: TReq,
      ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer R>
        ? Stream.Stream<A, UnexpectedError, R>
        : never =>
        Effect.gen(function* () {
          const sharedWorker = yield* Fiber.join(leaderThreadFiber)
          return sharedWorker
            .execute(req as any)
            .pipe(
              UnexpectedError.mapToUnexpectedErrorStream,
              Stream.withSpan(`@livestore/node:coordinator:runInWorkerStream:${req._tag}`),
            )
        }).pipe(Stream.unwrap) as any

      const executionBacklogQueue = yield* Queue.unbounded<WorkerSchema.ExecutionBacklogItem>().pipe(
        Effect.acquireRelease(Queue.shutdown),
      )

      // Continously take items from the backlog and execute them in the worker if there are any
      yield* Effect.gen(function* () {
        const items = yield* Queue.takeBetween(executionBacklogQueue, 1, 100).pipe(Effect.map(Chunk.toReadonlyArray))

        yield* runInWorker(new WorkerSchema.LeaderWorkerInner.ExecuteBulk({ items })).pipe(
          Effect.timeout(10_000),
          Effect.tapErrorCause((cause) =>
            Effect.logDebug('[@livestore/node:coordinator] executeBulkLoop error', cause, items),
          ),
        )

        // NOTE we're waiting a little bit for more items to come in before executing the batch
        yield* Effect.sleep(20)
      }).pipe(
        Effect.tapCauseLogPretty,
        Effect.forever,
        UnexpectedError.mapToUnexpectedError,
        Effect.interruptible,
        Effect.withSpan('@livestore/node:coordinator:executeBulkLoop'),
        Effect.tapErrorCause(shutdown),
        Effect.forkScoped,
      )

      const initialMutationEventId = yield* runInWorker(new WorkerSchema.LeaderWorkerInner.GetCurrentMutationEventId())

      const currentMutationEventIdRef = {
        current: { global: initialMutationEventId.global, local: initialMutationEventId.local },
      }

      const syncInMemoryDb = yield* makeSyncDb({ _tag: 'in-memory' }).pipe(Effect.orDie)

      yield* runInWorker(new WorkerSchema.LeaderWorkerInner.Export()).pipe(
        Effect.tap((res) => syncInMemoryDb.import(res)),
        Effect.timeout(10_000),
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/node:coordinator:export'),
      )

      const appHostId = `${storeId}-${sessionId}`

      const pullMutations = runInWorkerStream(new WorkerSchema.LeaderWorkerInner.PullStream()).pipe(
        // TODO handle rebase case
        Stream.tap((mutationEventEncoded) =>
          validateAndUpdateMutationEventId({
            currentMutationEventIdRef,
            mutationEventId: mutationEventEncoded.id,
            debugContext: { label: `client-session:pullMutations`, mutationEventEncoded },
          }),
        ),
        Stream.mapEffect((mutationEventEncoded) => Schema.decode(mutationEventSchema)(mutationEventEncoded)),
        Stream.orDie,
      )

      const coordinator = {
        networkStatus,
        execute: (query, bindValues) =>
          Effect.gen(function* () {
            const currentLockStatus = yield* SubscriptionRef.get(lockStatus)
            if (currentLockStatus === 'has-lock') {
              yield* Queue.offer(
                executionBacklogQueue,
                WorkerSchema.ExecutionBacklogItemExecute.make({ query, bindValues }),
              )
            } else {
              console.warn(`[@livestore/web:coordinator] TODO: implement execute without lock`, query, bindValues)
            }
          }),
        mutations: {
          pull: pullMutations,
          push: (mutationEventEncoded, { persisted }) =>
            Effect.gen(function* () {
              yield* Queue.offer(
                executionBacklogQueue,
                WorkerSchema.ExecutionBacklogItemMutate.make({ mutationEventEncoded, persisted }),
              )
            }).pipe(
              UnexpectedError.mapToUnexpectedError,
              Effect.withSpan('@livestore/node:coordinator:mutate', {
                attributes: { mutation: mutationEventEncoded.mutation },
              }),
            ),
          nextMutationEventIdPair: makeNextMutationEventIdPair(currentMutationEventIdRef),
          getCurrentMutationEventId: Effect.gen(function* () {
            // const global = (yield* seqState.get).pipe(Option.getOrElse(() => 0))
            // const local = (yield* seqLocalOnlyState.get).pipe(Option.getOrElse(() => 0))
            // return { global, local }
            return currentMutationEventIdRef.current
          }),
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
      } satisfies Coordinator

      if (devtoolsEnabled) {
        yield* Effect.gen(function* () {
          const storeDevtoolsChannel = yield* makeNodeDevtoolsChannel({
            nodeName: `app-store-${appHostId}`,
            target: 'devtools',
            url: `ws://localhost:${devtoolsOptions.port}`,
            schema: { listen: Devtools.MessageToAppHostStore, send: Devtools.MessageFromAppHostStore },
          })

          // TODO handle disconnect/reconnect
          yield* connectDevtoolsToStore(storeDevtoolsChannel)
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)
      }

      return { coordinator, syncDb: syncInMemoryDb }
    }).pipe(Effect.withSpan('@livestore/node:adapter'), Effect.provide(NodeFileSystem.layer))) satisfies Adapter
