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
    makeLayer: (_testContext) => {
      console.log(`[TEST CONTEXT] Creating layer for test with suffix: ${suffix || 'none'}`)
      return Layer.mergeAll(
        // makeFileLogger('runner', { testContext }), // Disabled for debugging - logs go to stdout
        WranglerDevServerService.Default({
          cwd: `${import.meta.dirname}/fixtures`,
          showLogs: IS_CI, // Show Wrangler logs in CI for debugging
        }).pipe(
          Layer.provide(PlatformNode.NodeContext.layer),
          Layer.tap(() => Effect.sync(() => {
            console.log(`[TEST CONTEXT] WranglerDevServerService layer created for suffix: ${suffix || 'none'}`)
          }))
        ),
      )
    },
  })

// Run tests sequentially in CI to avoid resource contention
// The Wrangler fix alone wasn't sufficient - concurrent execution still causes timeouts
const describe = IS_CI ? Vitest.describe : Vitest.describe.concurrent
describe('node-sync', { timeout: testTimeout }, () => {
  if (IS_CI) {
    console.log('[DEBUG] node-sync test suite starting')
    console.log('[DEBUG] Test execution mode:', IS_CI ? 'SEQUENTIAL' : 'CONCURRENT')
    logProcessState('Test suite start')
  }
  
  Vitest.scopedLive.prop(
    'create 4 todos on client-a and wait for them to be synced to client-b',
    [WorkerSchema.StorageType, WorkerSchema.AdapterType],
    ([storageType, adapterType], test) =>
      Effect.gen(function* () {
        const testId = Math.random().toString(36).substring(7)
        console.log(`\n[TEST-${testId}] Starting simple test (4 todos)`)
        console.log(`[TEST-${testId}] Parameters: storageType=${storageType}, adapterType=${adapterType}`)
        if (IS_CI) {
          logProcessState(`Before simple test ${testId}`)
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

        console.log(`[TEST-${testId}] Simple test completed successfully`)
        if (IS_CI) {
          console.log(`[TEST-${testId}] Active worker PIDs: ${activeWorkerPids.size}`)
          logProcessState(`After simple test ${testId}`)
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
        const propTestId = Math.random().toString(36).substring(7)
        console.log(`\n=== [PROP-TEST-${propTestId}] Run ${runIndex + 1}/${numRuns} Starting ===`)
        console.log(`[PROP-TEST-${propTestId}] Time: ${new Date().toISOString()}`)
        console.log(`[PROP-TEST-${propTestId}] Config:`, {
          storageType,
          adapterType,
          todoCountA,
          todoCountB,
          commitBatchSize,
          leaderPushBatchSize,
          simulationParams,
        })
        
        if (IS_CI) {
          logProcessState(`Before prop test ${propTestId}`)
        }

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
          `[PROP-TEST-${propTestId}] Sync completed in ${syncTime}s, total test time: ${Math.round((Date.now() - testStartTime) / 1000)}s`,
        )
        
        if (IS_CI) {
          console.log(`[PROP-TEST-${propTestId}] Test completed successfully`)
          logProcessState(`After prop test ${propTestId}`)
        }
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
    const workerInstanceId = `${workerId}-${Math.random().toString(36).substring(7)}`
    console.log(`[WORKER-${workerInstanceId}] Creating worker for ${clientId}`)
    console.log(`[WORKER-${workerInstanceId}] Config: storeId=${storeId}, adapter=${adapterType}, storage=${storageType}`)
    
    if (IS_CI) {
      console.log(`[WORKER-${workerInstanceId}] Global worker count: ${workerCount}`)
      console.log(`[WORKER-${workerInstanceId}] Active worker PIDs before creation: ${activeWorkerPids.size}`)
      if (activeWorkerPids.size > 0) {
        console.log(`[WORKER-${workerInstanceId}] WARNING: ${activeWorkerPids.size} workers still active from previous tests`)
      }
      logActiveWorkers()
    }

    console.log(`[WORKER-${workerInstanceId}] Accessing WranglerDevServerService`)
    const server = yield* WranglerDevServerService
    console.log(`[WORKER-${workerInstanceId}] Got WranglerDevServer: port=${server.port}, url=${server.url}, pid=${server.processId}`)
    
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
            console.log(`[WORKER-${workerInstanceId}] Child process created: PID=${childProcess.pid} for ${clientId}`)
            console.log(`[WORKER-${workerInstanceId}] Total active PIDs now: ${activeWorkerPids.size}`)

            childProcess.on('exit', (code) => {
              console.log(`[WORKER-${workerInstanceId}] Child process exited: PID=${childProcess.pid}, code=${code}, client=${clientId}`)
              activeWorkerPids.delete(childProcess.pid!)
              console.log(`[WORKER-${workerInstanceId}] Active PIDs after exit: ${activeWorkerPids.size}`)
            })

            childProcess.on('error', (err) => {
              console.error(`[WORKER-${workerInstanceId}] Child process error: PID=${childProcess.pid}, client=${clientId}`, err)
            })
          } else {
            console.warn(`[WORKER-${workerInstanceId}] WARNING: Child process created without PID for ${clientId}`)
          }

          return childProcess
        }),
      ),
      Effect.tapCauseLogPretty,
      Effect.withSpan(`@livestore/adapter-node-sync:test:boot-worker-${clientId}`),
    )

    console.log(`[WORKER-${workerInstanceId}] Worker successfully created for ${clientId}`)
    return worker
  })
