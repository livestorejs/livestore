import './thread-polyfill.ts'

import * as ChildProcess from 'node:child_process'
import { ClientSessionSyncProcessorSimulationParams } from '@livestore/common'
import { IS_CI, stringifyObject } from '@livestore/utils'
import { Effect, Layer, Schema, Stream, Worker } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessWorker, PlatformNode } from '@livestore/utils/node'
import { WranglerDevServerService } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { makeFileLogger } from './fixtures/file-logger.ts'
import * as WorkerSchema from './worker-schema.ts'

// Timeout needs to be long enough to allow for all the test runs to complete, especially in CI where the environment is slower.
// A single test run can take significant time depending on the passed todo count and simulation params.
const testTimeout = IS_CI ? 600_000 : 900_000

const withTestCtx = ({ suffix }: { suffix?: string } = {}) =>
  Vitest.makeWithTestCtx({
    suffix,
    timeout: testTimeout,
    makeLayer: (testContext) =>
      Layer.mergeAll(
        makeFileLogger('runner', { testContext }),
        WranglerDevServerService.Default({ cwd: `${import.meta.dirname}/fixtures` }).pipe(
          Layer.provide(PlatformNode.NodeContext.layer),
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

        yield* clientA.executeEffect(WorkerSchema.CreateTodos.make({ count: todoCount }))

        const result = yield* clientB.execute(WorkerSchema.StreamTodos.make()).pipe(
          Stream.filter((_) => _.length === todoCount),
          Stream.runHead,
          Effect.flatten,
        )

        expect(result.length).toEqual(todoCount)
      }).pipe(withTestCtx()(test)),
    { fastCheck: { numRuns: 4 } },
  )

  // Warning: A high CreateCount coupled with high simulation params can lead to very long test runs since those get multiplied with the number of todos.
  const CreateCount = Schema.Int.pipe(Schema.between(1, 400))
  const CommitBatchSize = Schema.Literal(1, 2, 10, 100)
  const LEADER_PUSH_BATCH_SIZE = Schema.Literal(1, 2, 10, 100)
  // TODO introduce random delays in async operations as part of prop testing

  Vitest.scopedLive.prop(
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
    ) =>
      Effect.gen(function* () {
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
        yield* clientA
          .executeEffect(WorkerSchema.CreateTodos.make({ count: todoCountA, commitBatchSize }))
          .pipe(Effect.fork)

        yield* clientB
          .executeEffect(WorkerSchema.CreateTodos.make({ count: todoCountB, commitBatchSize }))
          .pipe(Effect.fork)

        const exec = Effect.all(
          [
            clientA.execute(WorkerSchema.StreamTodos.make()).pipe(
              Stream.filter((_) => _.length === totalCount),
              Stream.runHead,
              Effect.flatten,
            ),
            clientB.execute(WorkerSchema.StreamTodos.make()).pipe(
              Stream.filter((_) => _.length === totalCount),
              Stream.runHead,
              Effect.flatten,
            ),
          ],
          { concurrency: 'unbounded' },
        )

        const onShutdown = Effect.raceFirst(
          clientA.executeEffect(WorkerSchema.OnShutdown.make()),
          clientB.executeEffect(WorkerSchema.OnShutdown.make()),
        )

        yield* Effect.raceFirst(exec, onShutdown)
      }).pipe(
        Effect.logDuration(`${test.task.suite?.name}:${test.task.name}`),
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
      ),
    Vitest.DEBUGGER_ACTIVE
      ? { fastCheck: { numRuns: 1 }, timeout: testTimeout * 100 }
      : { fastCheck: { numRuns: IS_CI ? 6 : 20 } },
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
    const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.Request.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () =>
        WorkerSchema.InitialMessage.make({ storeId, clientId, adapterType, storageType, params, syncUrl: server.url }),
    }).pipe(
      Effect.provide(
        ChildProcessWorker.layer(() =>
          ChildProcess.fork(
            new URL('./client-node-worker.ts', import.meta.url),
            // TODO get rid of this once passing args to the worker parent span is supported (wait for Tim Smart)
            [clientId],
          ),
        ),
      ),
      Effect.tapCauseLogPretty,
      Effect.withSpan(`@livestore/adapter-node-sync:test:boot-worker-${clientId}`),
    )

    return worker
  })
