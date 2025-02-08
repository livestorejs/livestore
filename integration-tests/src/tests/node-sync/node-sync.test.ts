import './thread-polyfill.js'

import * as ChildProcess from 'node:child_process'

import { IS_CI } from '@livestore/utils'
import { Effect, identity, Layer, Logger, Stream, Worker } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessWorker, OtelLiveHttp } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils/node-vitest'
import { expect } from 'vitest'

import * as WorkerSchema from './worker-schema.js'

const testTimeout = IS_CI ? 60_000 : 10_000

Vitest.describe('node-sync', { timeout: testTimeout }, () => {
  Vitest.scopedLive.prop(
    'node-sync',
    [WorkerSchema.AdapterType],
    ([adapterType], test) =>
      Effect.gen(function* () {
        const storeId = nanoid(10)
        const todoCount = 4

        const [clientA, clientB] = yield* Effect.all(
          [
            makeWorker({ clientId: 'client-a', storeId, adapterType }),
            makeWorker({ clientId: 'client-b', storeId, adapterType }),
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
    { fastCheck: { numRuns: 2 } },
  )
})

const makeWorker = ({
  clientId,
  storeId,
  adapterType,
}: {
  clientId: string
  storeId: string
  adapterType: typeof WorkerSchema.AdapterType.Type
}) =>
  Effect.gen(function* () {
    const nodeChildProcess = ChildProcess.fork(
      new URL('../../../dist/tests/node-sync/client-node-worker.js', import.meta.url),
      // TODO get rid of this once passing args to the worker parent span is supported (wait for Tim Smart)
      [clientId],
    )

    const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.Request.Type>({
      size: 1,
      concurrency: 100,
      initialMessage: () => WorkerSchema.InitialMessage.make({ storeId, clientId, adapterType }),
    }).pipe(
      Effect.provide(ChildProcessWorker.layer(() => nodeChildProcess)),
      Effect.tapCauseLogPretty,
      Effect.withSpan(`@livestore/node-sync:test:boot-worker-${clientId}`),
    )

    return worker
  })

const otelLayer = IS_CI ? Layer.empty : OtelLiveHttp({ serviceName: 'node-sync-test:runner', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix, skipOtel = false }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(testTimeout),
      Effect.provide(Logger.prettyWithThread('runner')),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      skipOtel ? identity : Effect.provide(otelLayer),
    )
