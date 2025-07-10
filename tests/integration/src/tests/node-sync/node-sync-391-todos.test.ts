// import './thread-polyfill.js'

// import * as ChildProcess from 'node:child_process'
// import * as inspector from 'node:inspector'

// import { IS_CI } from '@livestore/utils'
// import { Duration, Effect, identity, Layer, Logger, Schema, Stream, Worker } from '@livestore/utils/effect'
// import { nanoid } from '@livestore/utils/nanoid'
// import { ChildProcessWorker } from '@livestore/utils/node'
// import { OtelLiveHttp } from '@livestore/utils-dev/node'
// import { Vitest } from '@livestore/utils-dev/node-vitest'
// import { expect } from 'vitest'

// import * as WorkerSchema from './worker-schema.js'

// const testTimeout = IS_CI ? 120_000 : 15_000
// const propTestTimeout = IS_CI ? 300_000 : 120_000

// const DEBUGGER_ACTIVE = Boolean(process.env.DEBUGGER_ACTIVE ?? inspector.url() !== undefined)

// Vitest.describe.concurrent('node-sync-391-todos', { timeout: testTimeout }, () => {
//   Vitest.scopedLive.prop(
//     '391 todos stress test',
//     DEBUGGER_ACTIVE
//       ? [
//           Schema.Literal('fs'),
//           Schema.Literal('worker'),
//           Schema.Literal(3),
//           Schema.Literal(391),
//           Schema.Literal(1),
//           Schema.Literal(1),
//         ]
//       : [
//           WorkerSchema.StorageType,
//           WorkerSchema.AdapterType,
//           Schema.Literal(3),
//           Schema.Literal(391),
//           Schema.Literal(1),
//           Schema.Literal(1),
//         ],
//     ([storageType, adapterType, todoCountA, todoCountB, commitBatchSize, leaderPushBatchSize], test) =>
//       Effect.gen(function* () {
//         const storeId = nanoid(10)
//         const totalCount = todoCountA + todoCountB
//         console.log('391 todos stress test', {
//           storageType,
//           adapterType,
//           todoCountA,
//           todoCountB,
//           commitBatchSize,
//           leaderPushBatchSize,
//         })

//         const [clientA, clientB] = yield* Effect.all(
//           [
//             makeWorker({ clientId: 'client-a', storeId, adapterType, storageType, leaderPushBatchSize }),
//             makeWorker({ clientId: 'client-b', storeId, adapterType, storageType, leaderPushBatchSize }),
//           ],
//           { concurrency: 'unbounded' },
//         )

//         yield* clientA
//           .executeEffect(WorkerSchema.CreateTodos.make({ count: todoCountA, commitBatchSize }))
//           .pipe(Effect.fork)

//         yield* clientB
//           .executeEffect(WorkerSchema.CreateTodos.make({ count: todoCountB, commitBatchSize }))
//           .pipe(Effect.fork)

//         const exec = Effect.all(
//           [
//             clientA.execute(WorkerSchema.StreamTodos.make()).pipe(
//               Stream.filter((_) => _.length === totalCount),
//               Stream.runHead,
//               Effect.flatten,
//             ),
//             clientB.execute(WorkerSchema.StreamTodos.make()).pipe(
//               Stream.filter((_) => _.length === totalCount),
//               Stream.runHead,
//               Effect.flatten,
//             ),
//           ],
//           { concurrency: 'unbounded' },
//         )

//         const onShutdown = Effect.raceFirst(
//           clientA.executeEffect(WorkerSchema.OnShutdown.make()),
//           clientB.executeEffect(WorkerSchema.OnShutdown.make()),
//         )

//         yield* Effect.raceFirst(exec, onShutdown)
//       }).pipe(
//         Effect.logDuration(`${test.task.suite?.name}:${test.task.name}`),
//         withCtx(test, {
//           suffix: `adapterType=${adapterType} todoCountA=${todoCountA} todoCountB=${todoCountB}`,
//         }),
//       ),
//     DEBUGGER_ACTIVE
//       ? { fastCheck: { numRuns: 1 }, timeout: propTestTimeout * 100 }
//       : { fastCheck: { numRuns: 6 }, timeout: propTestTimeout },
//   )
// })

// const makeWorker = ({
//   clientId,
//   storeId,
//   adapterType,
//   storageType,
//   leaderPushBatchSize,
// }: {
//   clientId: string
//   storeId: string
//   adapterType: typeof WorkerSchema.AdapterType.Type
//   storageType: typeof WorkerSchema.StorageType.Type
//   leaderPushBatchSize?: number
// }) =>
//   Effect.gen(function* () {
//     const nodeChildProcess = ChildProcess.fork(
//       new URL('../../../dist/src/tests/node-sync/client-node-worker.js', import.meta.url),
//       [clientId],
//     )

//     const worker = yield* Worker.makePoolSerialized<typeof WorkerSchema.Request.Type>({
//       size: 1,
//       concurrency: 100,
//       initialMessage: () =>
//         WorkerSchema.InitialMessage.make({
//           storeId,
//           clientId,
//           adapterType,
//           storageType,
//           params: { leaderPushBatchSize },
//         }),
//     }).pipe(
//       Effect.provide(ChildProcessWorker.layer(() => nodeChildProcess)),
//       Effect.tapCauseLogPretty,
//       Effect.withSpan(`@livestore/adapter-node-sync:test:boot-worker-${clientId}`),
//     )

//     return worker
//   })

// const otelLayer = IS_CI ? Layer.empty : OtelLiveHttp({ serviceName: 'node-sync-test:runner', skipLogUrl: false })

// const withCtx =
//   (testContext: Vitest.TestContext, { suffix }: { suffix?: string } = {}) =>
//   <A, E, R>(self: Effect.Effect<A, E, R>) => {
//     const spanName = `${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`
//     return self.pipe(
//       DEBUGGER_ACTIVE
//         ? identity
//         : Effect.logWarnIfTakesLongerThan({
//             duration: testTimeout * 0.8,
//             label: `${spanName} approaching timeout (timeout: ${Duration.format(testTimeout)})`,
//           }),
//       DEBUGGER_ACTIVE ? identity : Effect.timeout(testTimeout),
//       Effect.provide(Logger.prettyWithThread('runner')),
//       Effect.scoped,
//       Effect.withSpan(spanName),
//       Effect.annotateLogs({ suffix }),
//       DEBUGGER_ACTIVE ? Effect.provide(otelLayer) : identity,
//     )
//   }
