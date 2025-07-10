import './thread-polyfill.js'

import * as ChildProcess from 'node:child_process'
import * as inspector from 'node:inspector'
import { ClientSessionSyncProcessorSimulationParams } from '@livestore/common'
import { IS_CI } from '@livestore/utils'
import { Duration, Effect, identity, Layer, Schema, Stream, Worker } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessWorker } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { makeFileLogger } from './fixtures/file-logger.js'
import * as WorkerSchema from './worker-schema.js'

const testTimeout = IS_CI ? 120_000 : 15_000
const propTestTimeout = IS_CI ? 300_000 : 120_000

const DEBUGGER_ACTIVE = Boolean(process.env.DEBUGGER_ACTIVE ?? inspector.url() !== undefined)

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
      }).pipe(withCtx(test)),
    { fastCheck: { numRuns: 4 } },
  )

  const CreateCount = Schema.Int.pipe(Schema.between(1, 500))
  const CommitBatchSize = Schema.Literal(1, 2, 10, 100)
  const LEADER_PUSH_BATCH_SIZE = Schema.Literal(1, 2, 10, 100)
  // TODO introduce random delays in async operations as part of prop testing

  Vitest.scopedLive.prop(
    'node-sync prop tests',
    DEBUGGER_ACTIVE
      ? [
          Schema.Literal('fs'),
          Schema.Literal('worker'),
          Schema.Literal(3),
          Schema.Literal(391),
          Schema.Literal(1),
          Schema.Literal(2),
          Schema.Struct({
            pull: Schema.Struct({
              '1_before_leader_push_fiber_interrupt': Schema.Literal(0),
              '2_before_leader_push_queue_clear': Schema.Literal(10),
              '3_before_rebase_rollback': Schema.Literal(0),
              '4_before_leader_push_queue_offer': Schema.Literal(20),
              '5_before_leader_push_fiber_run': Schema.Literal(0),
            }),
          }),
        ]
      : [
          WorkerSchema.StorageType,
          WorkerSchema.AdapterType,
          CreateCount,
          CreateCount,
          CommitBatchSize,
          LEADER_PUSH_BATCH_SIZE,
          ClientSessionSyncProcessorSimulationParams,
        ],
    (
      [storageType, adapterType, todoCountA, todoCountB, commitBatchSize, leaderPushBatchSize, simulationParams],
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
        withCtx(test, {
          suffix: `adapterType=${adapterType} todoCountA=${todoCountA} todoCountB=${todoCountB}`,
        }),
      ),
    DEBUGGER_ACTIVE
      ? { fastCheck: { numRuns: 1 }, timeout: propTestTimeout * 100 }
      : { fastCheck: { numRuns: IS_CI ? 6 : 20 }, timeout: propTestTimeout },
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
    const nodeChildProcess = ChildProcess.fork(
      new URL('../../../dist/src/tests/node-sync/client-node-worker.js', import.meta.url),
      // TODO get rid of this once passing args to the worker parent span is supported (wait for Tim Smart)
      [clientId],
    )

    const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.Request.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () => WorkerSchema.InitialMessage.make({ storeId, clientId, adapterType, storageType, params }),
    }).pipe(
      Effect.provide(ChildProcessWorker.layer(() => nodeChildProcess)),
      Effect.tapCauseLogPretty,
      Effect.withSpan(`@livestore/adapter-node-sync:test:boot-worker-${clientId}`),
    )

    return worker
  })

const otelLayer = IS_CI ? Layer.empty : OtelLiveHttp({ serviceName: 'node-sync-test:runner', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TestContext, { suffix }: { suffix?: string } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) => {
    const spanName = `${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`

    return self.pipe(
      // Only provide logger here so we still see timeout logs in the console
      Effect.provide(makeFileLogger('runner', { testContext })),
      DEBUGGER_ACTIVE
        ? identity
        : Effect.logWarnIfTakesLongerThan({
            duration: testTimeout * 0.8,
            label: `${spanName} approaching timeout (timeout: ${Duration.format(testTimeout)})`,
          }),
      DEBUGGER_ACTIVE ? identity : Effect.timeout(testTimeout),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(spanName),
      Effect.annotateLogs({ suffix }),
      DEBUGGER_ACTIVE ? Effect.provide(otelLayer) : identity,
    )
  }
