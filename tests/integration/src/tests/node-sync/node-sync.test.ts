import './thread-polyfill.ts'
import * as ChildProcess from 'node:child_process'

import { expect } from 'vitest'

import { ClientSessionSyncProcessorSimulationParams } from '@livestore/common'
import { IS_CI, stringifyObject } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { makeWranglerDevServerLayer, WranglerDevServerService } from '@livestore/utils-dev/wrangler'
import {
  Duration,
  Effect,
  EffectRpcClient,
  FastCheck,
  FetchHttpClient,
  Layer,
  Logger,
  RpcWorker,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessWorker } from '@livestore/utils/node'

import { makeFileLogger } from './fixtures/file-logger.ts'
import * as WorkerSchema from './worker-schema.ts'

import * as NodeServices from '@effect/platform-node/NodeServices'
// Timeout needs to be long enough to allow for all the test runs to complete, especially in CI where the environment is slower.
// A single test run can take significant time depending on the passed todo count and simulation params.
const testTimeout = Duration.toMillis(IS_CI === true ? Duration.minutes(10) : Duration.minutes(15))

// We might need to also run the tests in a CPU-limited environment as it might change the concurrency characteristics of the tests
// bash -c 'taskset -c 0 env CI=1 DEBUGGER_ACTIVE=0 NODE_SYNC_DEBUG=1 direnv exec . vitest run tests/integration/src/tests/node-sync/node-sync.test.ts --reporter verbose'

const withTestCtx = ({ suffix }: { suffix?: string } = {}) =>
  Vitest.makeWithTestCtx({
    suffix,
    timeout: testTimeout,
    makeLayer: (testContext) =>
      Layer.mergeAll(
        makeFileLogger('runner', { testContext }),
        makeWranglerDevServerLayer({
          cwd: `${import.meta.dirname}/fixtures`,
          readiness: { connectTimeout: Duration.seconds(45) },
        }).pipe(
          Layer.provide(
            Layer.mergeAll(
              NodeServices.layer,
              FetchHttpClient.layer,
              Logger.layer([Logger.consolePretty()]),
            ),
          ),
        ),
      ),
  })

Vitest.describe.concurrent('node-sync', { timeout: testTimeout }, () => {
  Vitest.scopedLive.prop(
    'create 4 todos on client-a and wait for them to be synced to client-b',
    [WorkerSchema.StorageType, WorkerSchema.AdapterType],
    ([storageType, adapterType], test) =>
      Effect.gen(function* () {
        const storeId = nanoid(10)
        const todoCount = 4

        const [clientA, clientB] = yield* Effect.all(
          [
            makeWorker({ clientId: 'client-a', storeId, adapterType, storageType }),
            makeWorker({ clientId: 'client-b', storeId, adapterType, storageType }),
          ],
          { concurrency: 'unbounded' },
        )

        yield* clientA.CreateTodos({ count: todoCount })

        const result = yield* clientB.StreamTodos(undefined).pipe(
          Stream.filter((_) => _.length === todoCount),
          Stream.runHead,
          Effect.andThen((option) => option._tag === 'Some' ? Effect.succeed(option.value) : Effect.die('no todos emitted')),
        )

        expect(result.length).toEqual(todoCount)
      }).pipe(withTestCtx()(test)),
    { fastCheck: { numRuns: 4 } },
  )

  // Warning: A high CreateCount coupled with high simulation params can lead to very long test runs since those get multiplied with the number of todos.
  const CreateCount = FastCheck.integer({ min: 1, max: 400 })
  const CommitBatchSize = FastCheck.constantFrom(1, 2, 10, 100)
  const LEADER_PUSH_BATCH_SIZE = FastCheck.constantFrom(1, 2, 10, 100)
  const SimulationParams = FastCheck.record({
    pull: FastCheck.record({
      '1_before_leader_push_fiber_interrupt': FastCheck.integer({ min: 0, max: 15 }),
      '2_before_leader_push_queue_clear': FastCheck.integer({ min: 0, max: 15 }),
      '3_before_rebase_rollback': FastCheck.integer({ min: 0, max: 15 }),
      '4_before_leader_push_queue_offer': FastCheck.integer({ min: 0, max: 15 }),
      '5_before_leader_push_fiber_run': FastCheck.integer({ min: 0, max: 15 }),
    }),
  })
  // TODO introduce random delays in async operations as part of prop testing

  // TODO investigate why stoping this test in VSC Vitest UI often doesn't stop the test runs
  // https://share.cleanshot.com/8gDKh62c
  Vitest.asProp(
    Vitest.scopedLive,
    'node-sync prop tests',
    Vitest.DEBUGGER_ACTIVE === true
      ? {
          storageType: Schema.Literal('fs'),
          adapterType: Schema.Literal('worker'),
          todoCountA: Schema.Literal(3),
          todoCountB: Schema.Literal(391),
          commitBatchSize: Schema.Literal(1),
          leaderPushBatchSize: Schema.Literal(2),
          simulationParams: Schema.Struct({
            // Keep values within allowed 0..15 range to avoid parse errors
            pull: Schema.Struct({
              '1_before_leader_push_fiber_interrupt': Schema.Literal(0),
              '2_before_leader_push_queue_clear': Schema.Literal(10),
              '3_before_rebase_rollback': Schema.Literal(0),
              '4_before_leader_push_queue_offer': Schema.Literal(15),
              '5_before_leader_push_fiber_run': Schema.Literal(0),
            }),
          }),
        }
      : {
          storageType: FastCheck.constantFrom('in-memory' as const, 'fs' as const),
          adapterType: FastCheck.constantFrom('single-threaded' as const, 'worker' as const),
          todoCountA: CreateCount,
          todoCountB: CreateCount,
          commitBatchSize: CommitBatchSize,
          leaderPushBatchSize: LEADER_PUSH_BATCH_SIZE,
          // TODO extend simulation tests to cover all parts of the client session and leader sync processor
          simulationParams: SimulationParams,
        },
    (
      { storageType, adapterType, todoCountA, todoCountB, commitBatchSize, leaderPushBatchSize, simulationParams },
      test,
      { numRuns, runIndex },
    ) =>
      Effect.gen(function* () {
        console.log(`Run ${runIndex + 1}/${numRuns}`, {
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
        yield* Effect.log('concurrent push', {
          storageType,
          adapterType,
          todoCountA,
          todoCountB,
          commitBatchSize,
          leaderPushBatchSize,
          simulationParams,
        })
        const params = { leaderPushBatchSize, simulation: simulationParams }

        const [clientA, clientB] = yield* Effect.all(
          [
            makeWorker({ clientId: 'client-a', storeId, adapterType, storageType, params }),
            makeWorker({ clientId: 'client-b', storeId, adapterType, storageType, params }),
          ],
          { concurrency: 'unbounded' },
        )

        // TODO also alternate the order and delay of todo creation as part of prop testing
        yield* clientA.CreateTodos({ count: todoCountA, commitBatchSize }).pipe(Effect.forkChild)

        yield* clientB.CreateTodos({ count: todoCountB, commitBatchSize }).pipe(Effect.forkChild)

        const exec = Effect.all(
          [
            clientA.StreamTodos(undefined).pipe(
              Stream.filter((_) => _.length === totalCount),
              Stream.runHead,
              Effect.andThen((option) => option._tag === 'Some' ? Effect.succeed(option.value) : Effect.die('client-a todos not emitted')),
            ),
            clientB.StreamTodos(undefined).pipe(
              Stream.filter((_) => _.length === totalCount),
              Stream.runHead,
              Effect.andThen((option) => option._tag === 'Some' ? Effect.succeed(option.value) : Effect.die('client-b todos not emitted')),
            ),
          ],
          { concurrency: 'unbounded' },
        )

        const onShutdown = Effect.raceFirst(
          clientA.OnShutdown(undefined),
          clientB.OnShutdown(undefined),
        )

        yield* Effect.raceFirst(exec, onShutdown)
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
    Vitest.DEBUGGER_ACTIVE === true
      ? { fastCheck: { numRuns: 1 }, timeout: testTimeout * 100 }
      : { fastCheck: { numRuns: IS_CI === true ? 6 : 20 } },
  )
})

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
    const server = yield* WranglerDevServerService
    // Warning: we need to build the layer here eagerly to tie it to the scope
    const workerLayer = EffectRpcClient.layerProtocolWorker({ size: 1, concurrency: 100 }).pipe(
      Layer.provide(
        RpcWorker.layerInitialMessage(
          WorkerSchema.InitialMessage,
          Effect.succeed(
            new WorkerSchema.InitialMessage({ storeId, clientId, adapterType, storageType, params, syncUrl: server.url }),
          ),
        ),
      ),
      Layer.provide(
        ChildProcessWorker.layer(() =>
          ChildProcess.fork(
            new URL('./client-node-worker.ts', import.meta.url),
            // TODO get rid of this once passing args to the worker parent span is supported (wait for Tim Smart)
            [clientId],
          ),
        ),
      ),
    )

    const worker = yield* Effect.gen(function* () {
      const scope = yield* Effect.scope
      const protocolContext = yield* Layer.buildWithScope(workerLayer, scope)
      return yield* EffectRpcClient.make(WorkerSchema.Rpcs).pipe(Effect.provide(protocolContext))
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.withSpan(`@livestore/adapter-node-sync:test:boot-worker-${clientId}`),
    )

    return worker
  })
