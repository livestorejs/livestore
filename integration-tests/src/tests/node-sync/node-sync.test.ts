import './thread-polyfill.js'

import * as ChildProcess from 'node:child_process'
import * as WT from 'node:worker_threads'

import { Effect, identity, Layer, Logger, Stream, Worker } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessWorker, OtelLiveHttp, PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils/node-vitest'
import { expect } from 'vitest'

import * as WorkerSchema from './worker-schema.js'

Vitest.describe('node-sync', { timeout: 10_000 }, () => {
  Vitest.scopedLive('node-sync', (test) =>
    Effect.gen(function* () {
      const storeId = nanoid(10)
      const todoCount = 4

      const [clientA, clientB] = yield* Effect.all(
        [makeWorker({ clientId: 'client-a', storeId }), makeWorker({ clientId: 'client-b', storeId })],
        { concurrency: 'unbounded' },
      )

      // Get rid of this once fixed https://github.com/Effect-TS/effect/issues/4215
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* clientA.executeEffect(WorkerSchema.TmpShutdown.make())
          yield* clientB.executeEffect(WorkerSchema.TmpShutdown.make())
        }).pipe(Effect.orDie),
      )

      yield* clientA.executeEffect(WorkerSchema.CreateTodos.make({ count: todoCount }))

      // const result = yield* workerA.execute(WorkerSchema.StreamTodos.make()).pipe(Stream.runHead, Effect.flatten)
      const result = yield* clientB.execute(WorkerSchema.StreamTodos.make()).pipe(
        Stream.filter((_) => _.length === todoCount),
        Stream.runHead,
        Effect.flatten,
      )

      expect(result.length).toEqual(todoCount)
      yield* clientA.executeEffect(WorkerSchema.TmpShutdown.make())
      yield* clientB.executeEffect(WorkerSchema.TmpShutdown.make())
    }).pipe(withCtx(test)),
  )
})

const makeWorker = ({ clientId, storeId }: { clientId: string; storeId: string }) =>
  Effect.gen(function* () {
    // const nodeWorker = new WT.Worker(new URL('../../../dist/tests/node-sync/client-node-thread.js', import.meta.url))
    const nodeChildProcess = ChildProcess.fork(
      new URL('../../../dist/tests/node-sync/client-node-worker.js', import.meta.url),
      // TODO get rid of this once passing args to the worker parent span is supported (wait for Tim Smart)
      [clientId],
    )

    const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.Request.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () => WorkerSchema.InitialMessage.make({ storeId, clientId }),
    }).pipe(
      Effect.provide(ChildProcessWorker.layer(() => nodeChildProcess)),
      // Effect.provide(PlatformNode.NodeWorker.layer(() => nodeWorker)),
      Effect.tapCauseLogPretty,
      Effect.withSpan(`@livestore/node-sync:test:boot-worker-${clientId}`),
    )

    return worker
  })

const envTruish = (env: string | undefined) => env !== undefined && env !== 'false' && env !== '0'
const isCi = envTruish(process.env.CI)

const otelLayer = isCi ? Layer.empty : OtelLiveHttp({ serviceName: 'node-sync-test:runner', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix, skipOtel = false }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.andThen(() => Effect.spanEvent('@livestore/node-sync:test:runner:end')),
      Effect.timeout(isCi ? 60_000 : 10_000),
      Effect.provide(Logger.pretty),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      skipOtel ? identity : Effect.provide(otelLayer),
    )
