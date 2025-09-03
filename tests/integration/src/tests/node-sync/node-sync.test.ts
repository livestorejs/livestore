import './thread-polyfill.ts'

import * as ChildProcess from 'node:child_process'
import { ClientSessionSyncProcessorSimulationParams } from '@livestore/common'
import { IS_CI, stringifyObject } from '@livestore/utils'
import { Duration, Effect, Layer, Schedule, Schema, Stream, Worker } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessWorker, PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { logActiveWorkers, logProcessState, setupProcessMonitoring } from './debug-helpers.ts'
import * as WorkerSchema from './worker-schema.ts'

// Set up process monitoring early in CI
if (IS_CI) {
  console.log('[DEBUG] Setting up process monitoring for CI environment')
  setupProcessMonitoring()
  logProcessState('Test file initialization')
}

// Timeout needs to be long enough to allow for all the test runs to complete, especially in CI where the environment is slower.
// A single test run can take significant time depending on the passed todo count and simulation params.
const testTimeout = Duration.toMillis(IS_CI ? Duration.minutes(10) : Duration.minutes(15))

const withTestCtx = ({ suffix }: { suffix?: string } = {}) =>
  Vitest.makeWithTestCtx({
    suffix,
    timeout: testTimeout,
    makeLayer: (_testContext) =>
      Layer.mergeAll(
        // makeFileLogger('runner', { testContext }), // Disabled for debugging - logs go to stdout
        WranglerDevServerService.Default({
          cwd: `${import.meta.dirname}/fixtures`,
          showLogs: IS_CI, // Show Wrangler logs in CI for debugging
        }).pipe(Layer.provide(PlatformNode.NodeContext.layer)),
      ),
  })

// Tests can now run concurrently since we fixed the Wrangler inspector port conflicts
Vitest.describe.concurrent('node-sync', { timeout: testTimeout }, () => {
  if (IS_CI) {
    console.log('[DEBUG] node-sync test suite starting')
    logProcessState('Test suite start')
  }
  Vitest.scopedLive.prop(
    'create 4 todos on client-a and wait for them to be synced to client-b',
    [WorkerSchema.StorageType, WorkerSchema.AdapterType],
    ([storageType, adapterType], test) =>
      Effect.gen(function* () {
        console.log('\n[TEST TRANSITION] Starting simple test (4 todos)')
        if (IS_CI) {
          logProcessState('Before simple test')
        }

        const storeId = nanoid(10)
        const todoCount = 4

        yield* Effect.log(`Starting test: create ${todoCount} todos on client-a and sync to client-b`, {
          storeId,
          adapterType,
          storageType,
        })

        const [clientA, clientB] = yield* Effect.all(
          [
            makeWorker({ clientId: 'client-a', storeId, adapterType, storageType }),
            makeWorker({ clientId: 'client-b', storeId, adapterType, storageType }),
          ],
          { concurrency: 'unbounded' },
        )

        yield* Effect.log('Workers initialized, creating todos on client-a')
        yield* clientA.executeEffect(WorkerSchema.CreateTodos.make({ count: todoCount }))

        yield* Effect.log('Todos created, waiting for sync to client-b')
        const result = yield* clientB.execute(WorkerSchema.StreamTodos.make()).pipe(
          Stream.filter((_) => _.length === todoCount),
          Stream.runHead,
          Effect.flatten,
        )

        yield* Effect.log(`Test completed: ${result.length} todos synced`)
        expect(result.length).toEqual(todoCount)

        console.log('[TEST TRANSITION] Simple test completed')
        if (IS_CI) {
          console.log(`[TEST TRANSITION] Active worker PIDs: ${activeWorkerPids.size}`)
          logProcessState('After simple test')
        }
      }).pipe(withTestCtx()(test)),
    { fastCheck: { numRuns: 4 } },
  )

  // Warning: A high CreateCount coupled with high simulation params can lead to very long test runs since those get multiplied with the number of todos.
  // ATTEMPT 1: Restore original limits to reproduce timeout
  const CreateCount = Schema.Int.pipe(Schema.between(1, 400))
  const CommitBatchSize = Schema.Literal(1, 2, 10, 100)
  const LEADER_PUSH_BATCH_SIZE = Schema.Literal(1, 2, 10, 100)
  // TODO introduce random delays in async operations as part of prop testing

  // TODO investigate why stoping this test in VSC Vitest UI often doesn't stop the test runs
  // https://share.cleanshot.com/8gDKh62c
  Vitest.asProp(
    Vitest.scopedLive,
    'node-sync prop tests',
    Vitest.DEBUGGER_ACTIVE
      ? {
          storageType: Schema.Literal('fs'),
          adapterType: Schema.Literal('worker'),
          todoCountA: Schema.Literal(3),
          todoCountB: Schema.Literal(391),
          commitBatchSize: Schema.Literal(1),
          leaderPushBatchSize: Schema.Literal(2),
          simulationParams: Schema.Struct({
            pull: Schema.Struct({
              '1_before_leader_push_fiber_interrupt': Schema.Literal(0),
              '2_before_leader_push_queue_clear': Schema.Literal(10),
              '3_before_rebase_rollback': Schema.Literal(0),
              '4_before_leader_push_queue_offer': Schema.Literal(20),
              '5_before_leader_push_fiber_run': Schema.Literal(0),
            }),
          }),
        }
      : {
          storageType: WorkerSchema.StorageType,
          adapterType: WorkerSchema.AdapterType,
          todoCountA: CreateCount,
          todoCountB: CreateCount,
          commitBatchSize: CommitBatchSize,
          leaderPushBatchSize: LEADER_PUSH_BATCH_SIZE,
          // TODO extend simulation tests to cover all parts of the client session and leader sync processor
          simulationParams: ClientSessionSyncProcessorSimulationParams,
        },
    (
      { storageType, adapterType, todoCountA, todoCountB, commitBatchSize, leaderPushBatchSize, simulationParams },
      test,
      { numRuns, runIndex },
    ) =>
      Effect.gen(function* () {
        const testStartTime = Date.now()
        console.log(`\n=== Test Run ${runIndex + 1}/${numRuns} Starting ===`)
        console.log(`Time: ${new Date().toISOString()}`)
        console.log(`Config:`, {
          storageType,
          adapterType,
          todoCountA,
          todoCountB,
          commitBatchSize,
          leaderPushBatchSize,
          simulationParams,
        })

        const storeId = nanoid(10)
        const totalCount = todoCountA + todoCountB
        yield* Effect.log('Starting concurrent push test', {
          storeId,
          totalCount,
          storageType,
          adapterType,
          todoCountA,
          todoCountB,
          commitBatchSize,
          leaderPushBatchSize,
          simulationParams,
        })
        const params = { leaderPushBatchSize, simulation: simulationParams }

        // Add progress indicator that updates every 30 seconds
        const progressIndicator = Effect.repeat(
          Effect.sync(() => {
            const elapsed = Math.round((Date.now() - testStartTime) / 1000)
            console.log(`[Progress] Test still running... elapsed: ${elapsed}s`)
          }),
          Schedule.fixed('30 seconds'),
        ).pipe(Effect.fork)

        yield* progressIndicator

        yield* Effect.log('Initializing workers...')
        const [clientA, clientB] = yield* Effect.all(
          [
            makeWorker({ clientId: 'client-a', storeId, adapterType, storageType, params }),
            makeWorker({ clientId: 'client-b', storeId, adapterType, storageType, params }),
          ],
          { concurrency: 'unbounded' },
        )
        yield* Effect.log('Workers initialized successfully')

        // TODO also alternate the order and delay of todo creation as part of prop testing
        yield* Effect.log(`Starting todo creation: client-a=${todoCountA}, client-b=${todoCountB}`)

        const createA = clientA
          .executeEffect(WorkerSchema.CreateTodos.make({ count: todoCountA, commitBatchSize }))
          .pipe(
            Effect.tap(() => Effect.log(`Client-a finished creating ${todoCountA} todos`)),
            Effect.timeout('2 minutes'),
            Effect.catchTag('TimeoutException', () =>
              Effect.die(`Client-a timed out creating ${todoCountA} todos with batch size ${commitBatchSize}`),
            ),
            Effect.fork,
          )

        const createB = clientB
          .executeEffect(WorkerSchema.CreateTodos.make({ count: todoCountB, commitBatchSize }))
          .pipe(
            Effect.tap(() => Effect.log(`Client-b finished creating ${todoCountB} todos`)),
            Effect.timeout('2 minutes'),
            Effect.catchTag('TimeoutException', () =>
              Effect.die(`Client-b timed out creating ${todoCountB} todos with batch size ${commitBatchSize}`),
            ),
            Effect.fork,
          )

        yield* createA
        yield* createB

        yield* Effect.log(`Waiting for sync: expecting ${totalCount} todos on both clients`)
        const syncStartTime = Date.now()

        const exec = Effect.all(
          [
            clientA.execute(WorkerSchema.StreamTodos.make()).pipe(
              Stream.tap((todos) =>
                todos.length > 0 && todos.length % 50 === 0
                  ? Effect.log(`Client-a progress: ${todos.length}/${totalCount} todos`)
                  : Effect.void,
              ),
              Stream.filter((_) => _.length === totalCount),
              Stream.runHead,
              Effect.flatten,
              Effect.tap(() => Effect.log(`Client-a received all ${totalCount} todos`)),
            ),
            clientB.execute(WorkerSchema.StreamTodos.make()).pipe(
              Stream.tap((todos) =>
                todos.length > 0 && todos.length % 50 === 0
                  ? Effect.log(`Client-b progress: ${todos.length}/${totalCount} todos`)
                  : Effect.void,
              ),
              Stream.filter((_) => _.length === totalCount),
              Stream.runHead,
              Effect.flatten,
              Effect.tap(() => Effect.log(`Client-b received all ${totalCount} todos`)),
            ),
          ],
          { concurrency: 'unbounded' },
        )

        const onShutdown = Effect.raceFirst(
          clientA.executeEffect(WorkerSchema.OnShutdown.make()),
          clientB.executeEffect(WorkerSchema.OnShutdown.make()),
        )

        yield* Effect.raceFirst(exec, onShutdown)
        const syncTime = Math.round((Date.now() - syncStartTime) / 1000)
        yield* Effect.log(
          `Sync completed in ${syncTime}s, total test time: ${Math.round((Date.now() - testStartTime) / 1000)}s`,
        )
      }).pipe(
        withTestCtx({
          suffix: stringifyObject({
            adapterType,
            todoCountA,
            todoCountB,
            commitBatchSize,
            leaderPushBatchSize,
            simulationParams,
          }),
        })(test),
        // Logging without context (to make sure log is always displayed)
        Effect.logDuration(`${test.task.suite?.name}:${test.task.name} (Run ${runIndex + 1}/${numRuns})`),
      ),
    Vitest.DEBUGGER_ACTIVE
      ? { fastCheck: { numRuns: 1 }, timeout: testTimeout * 100 }
      : { fastCheck: { numRuns: IS_CI ? 6 : 20 } }, // ATTEMPT 1: Restore original 6 runs
  )
})

// Add cleanup tracking
let workerCount = 0
const activeWorkerPids = new Set<number>()

const makeWorker = ({
  clientId,
  storeId,
  adapterType,
  storageType,
  params,
}: {
  clientId: string
  storeId: string
  adapterType: typeof WorkerSchema.AdapterType.Type
  storageType: typeof WorkerSchema.StorageType.Type
  params?: WorkerSchema.Params
}) =>
  Effect.gen(function* () {
    const workerId = ++workerCount
    console.log(`[WORKER] Creating worker #${workerId} for ${clientId}`)
    if (IS_CI) {
      console.log(`[WORKER] Active workers before: ${activeWorkerPids.size}`)
      logActiveWorkers()
    }

    const server = yield* WranglerDevServerService
    const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.Request.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () =>
        WorkerSchema.InitialMessage.make({ storeId, clientId, adapterType, storageType, params, syncUrl: server.url }),
    }).pipe(
      Effect.provide(
        ChildProcessWorker.layer(() => {
          const childProcess = ChildProcess.fork(
            new URL('./client-node-worker.ts', import.meta.url),
            // TODO get rid of this once passing args to the worker parent span is supported (wait for Tim Smart)
            [clientId],
          )

          // Track the child process
          if (childProcess.pid) {
            activeWorkerPids.add(childProcess.pid)
            console.log(`[WORKER] Child process created: PID=${childProcess.pid} for ${clientId}`)

            childProcess.on('exit', (code) => {
              console.log(`[WORKER] Child process exited: PID=${childProcess.pid}, code=${code}, client=${clientId}`)
              activeWorkerPids.delete(childProcess.pid!)
            })

            childProcess.on('error', (err) => {
              console.error(`[WORKER] Child process error: PID=${childProcess.pid}, client=${clientId}`, err)
            })
          }

          return childProcess
        }),
      ),
      Effect.tapCauseLogPretty,
      Effect.withSpan(`@livestore/adapter-node-sync:test:boot-worker-${clientId}`),
    )

    return worker
  })
