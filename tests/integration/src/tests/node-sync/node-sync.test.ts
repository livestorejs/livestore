import './thread-polyfill.js'

import * as ChildProcess from 'node:child_process'
import * as inspector from 'node:inspector'

import { IS_CI } from '@livestore/utils'
import { Effect, identity, Layer, Logger, Schema, Stream, Worker } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessWorker } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import * as WorkerSchema from './worker-schema.js'

const testTimeout = IS_CI ? 120_000 : 15_000
const propTestTimeout = IS_CI ? 300_000 : 120_000

const DEBUGGER_ACTIVE = process.env.DEBUGGER_ACTIVE ?? inspector.url() !== undefined

Vitest.describe('node-sync', { timeout: testTimeout }, () => {
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
          Schema.Literal('single-threaded'),
          Schema.Literal(1),
          Schema.Literal(405),
          Schema.Literal(100),
          Schema.Literal(2),
        ]
      : [
          WorkerSchema.StorageType,
          WorkerSchema.AdapterType,
          CreateCount,
          CreateCount,
          CommitBatchSize,
          LEADER_PUSH_BATCH_SIZE,
        ],
    ([storageType, adapterType, todoCountA, todoCountB, commitBatchSize, leaderPushBatchSize], test) =>
      Effect.gen(function* () {
        const storeId = nanoid(10)
        const totalCount = todoCountA + todoCountB
        console.log('concurrent push', { adapterType, todoCountA, todoCountB, commitBatchSize, leaderPushBatchSize })

        const [clientA, clientB] = yield* Effect.all(
          [
            makeWorker({ clientId: 'client-a', storeId, adapterType, storageType, leaderPushBatchSize }),
            makeWorker({ clientId: 'client-b', storeId, adapterType, storageType, leaderPushBatchSize }),
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
          skipOtel: DEBUGGER_ACTIVE ? false : true,
          suffix: `adapterType=${adapterType} todoCountA=${todoCountA} todoCountB=${todoCountB}`,
        }),
      ),
    DEBUGGER_ACTIVE
      ? { fastCheck: { numRuns: 1 }, timeout: propTestTimeout * 100 }
      : { fastCheck: { numRuns: 6 }, timeout: propTestTimeout },
  )
})

const makeWorker = ({
  clientId,
  storeId,
  adapterType,
  storageType,
  leaderPushBatchSize,
}: {
  clientId: string
  storeId: string
  adapterType: typeof WorkerSchema.AdapterType.Type
  storageType: typeof WorkerSchema.StorageType.Type
  leaderPushBatchSize?: number
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
      initialMessage: () =>
        WorkerSchema.InitialMessage.make({
          storeId,
          clientId,
          adapterType,
          storageType,
          params: { leaderPushBatchSize },
        }),
    }).pipe(
      Effect.provide(ChildProcessWorker.layer(() => nodeChildProcess)),
      Effect.tapCauseLogPretty,
      Effect.withSpan(`@livestore/adapter-node-sync:test:boot-worker-${clientId}`),
    )

    return worker
  })

const otelLayer = IS_CI ? Layer.empty : OtelLiveHttp({ serviceName: 'node-sync-test:runner', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TestContext, { suffix, skipOtel = false }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      DEBUGGER_ACTIVE ? identity : Effect.timeout(testTimeout),
      Effect.provide(Logger.prettyWithThread('runner')),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      Effect.annotateLogs({ suffix }),
      skipOtel ? identity : Effect.provide(otelLayer),
    )
