import './thread-polyfill.ts'
import path from 'node:path'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { makeAdapter, makeWorkerAdapter } from '@livestore/adapter-node'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred, queryDb } from '@livestore/livestore'
import { makeWsSync } from '@livestore/sync-cf/client'
import { IS_CI } from '@livestore/utils'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import {
  Context,
  Deferred,
  Effect,
  Layer,
  OtelTracer,
  pipe,
  ReadonlyArray,
  RpcServer,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessRunner, OtelLiveDummy } from '@livestore/utils/node'

import { makeFileLogger } from './fixtures/file-logger.ts'
import { events, schema, tables } from './schema.ts'
import * as WorkerSchema from './worker-schema.ts'

class WorkerContext extends Context.Service<
  WorkerContext,
  {
    store: Store<any>
    shutdownDeferred: ShutdownDeferred
  }
>()('WorkerContext') {}

const clientId = process.argv[2]!

const WorkerContextLive = Layer.unwrapScoped(
  Effect.gen(function* () {
    const protocol = yield* RpcServer.Protocol
    const { storeId, clientId, adapterType, storageType, params, syncUrl } = yield* protocol.initialMessage.pipe(
      Effect.flatMap((option) => option.asEffect()),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.toCodecJson(WorkerSchema.InitialMessage))),
      Effect.orDie,
    )

    return yield* Effect.gen(function* () {
      const storage =
        storageType === 'fs'
          ? {
              type: 'fs' as const,
              baseDirectory: path.resolve(
                process.cwd(),
                `tmp`,
                new Date().toISOString().split('T')[0]!, // `YYYY-MM-DD`
                storeId,
                clientId,
              ),
            }
          : { type: 'in-memory' as const }

      const sync = { backend: makeWsSync({ url: syncUrl }) }

      const adapter =
        adapterType === 'single-threaded'
          ? makeAdapter({ storage, clientId, sync })
          : makeWorkerAdapter({
              workerUrl: new URL('./livestore.worker.ts', import.meta.url),
              storage: { type: 'in-memory' },
              clientId,
              workerExtraArgs: { syncUrl },
            })

      const shutdownDeferred = yield* makeShutdownDeferred

      const store = yield* createStore({
        adapter,
        schema,
        storeId,
        disableDevtools: true,
        shutdownDeferred,
        params: {
          leaderPushBatchSize: params?.leaderPushBatchSize,
          simulation: params?.simulation !== undefined ? { clientSessionSyncProcessor: params.simulation } : undefined,
        },
      })
      // @ts-expect-error for debugging
      globalThis.store = store

      return Layer.succeed(WorkerContext, { store, shutdownDeferred })
    })
  }).pipe(
    Effect.orDie,
    Effect.annotateLogs({ clientId }),
    Effect.annotateSpans({ clientId }),
    Effect.withSpan(`@livestore/adapter-node-sync:test:init-${clientId}`),
  ),
)

const runner = WorkerSchema.Rpcs.toLayer({
  CreateTodos: ({ count, commitBatchSize = 1 }) =>
    Effect.gen(function* () {
      // TODO check sync connection status
      const { store } = yield* WorkerContext
      const otelSpan = yield* OtelTracer.currentOtelSpan
      const eventBatches = pipe(
        ReadonlyArray.range(0, count - 1),
        ReadonlyArray.map((i) => events.todoCreated({ id: nanoid(), title: `todo ${i} (${clientId})` })),
        ReadonlyArray.chunksOf(commitBatchSize),
      )
      const spanLinks = [{ context: otelSpan.spanContext() }]
      for (const batch of eventBatches) {
        store.commit({ spanLinks }, ...batch)
      }
    }).pipe(Effect.withSpan('@livestore/adapter-node-sync:test:create-todos', { attributes: { count } }), Effect.orDie),
  StreamTodos: () =>
    Effect.gen(function* () {
      const { store } = yield* WorkerContext
      const query$ = queryDb(tables.todo.orderBy('id', 'desc'))
      return store.subscribeStream(query$)
    }).pipe(Stream.unwrap, Stream.withSpan('@livestore/adapter-node-sync:test:stream-todos')),
  OnShutdown: Effect.fn('@livestore/adapter-node-sync:test:on-shutdown')(function* () {
    const { shutdownDeferred } = yield* WorkerContext
    yield* Effect.catchTag(Deferred.await(shutdownDeferred), 'StoreInterrupted', () => Effect.void)
  }),
})

const serviceName = `node-sync-test:${clientId}`

RpcServer.make(WorkerSchema.Rpcs).pipe(
  Effect.provide(
    runner.pipe(
      Layer.provide(WorkerContextLive),
      Layer.provideMerge(RpcServer.layerProtocolWorkerRunner),
      Layer.provide(NodeServices.layer),
      Layer.provide(ChildProcessRunner.layer),
    ),
  ),
  // TODO this parent span is currently missing in the trace
  Effect.withSpan(`@livestore/adapter-node-sync:run-worker-${clientId}`),
  Effect.provide(IS_CI === true ? OtelLiveDummy : OtelLiveHttp({ serviceName, skipLogUrl: true })),
  Effect.scoped,
  Effect.tapCauseLogPretty,
  Effect.annotateLogs({ thread: serviceName, clientId }),
  Effect.annotateSpans({ clientId }),
  Effect.provide(makeFileLogger(`worker-${clientId}`)),
  (effect) => NodeRuntime.runMain(effect as Effect.Effect<never, unknown>),
)
