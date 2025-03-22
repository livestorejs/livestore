import './thread-polyfill.js'

import path from 'node:path'

import { makeInMemoryAdapter, makePersistedAdapter } from '@livestore/adapter-node'
import type { IntentionalShutdownCause, UnexpectedError } from '@livestore/common'
import type { ShutdownDeferred, Store, StoreInterrupted } from '@livestore/livestore'
import { createStore, queryDb } from '@livestore/livestore'
import { makeCfSync } from '@livestore/sync-cf'
import { IS_CI } from '@livestore/utils'
import {
  Context,
  Deferred,
  Effect,
  Layer,
  Logger,
  LogLevel,
  OtelTracer,
  pipe,
  ReadonlyArray,
  Stream,
  WorkerRunner,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessRunner, OtelLiveDummy, OtelLiveHttp, PlatformNode } from '@livestore/utils/node'

import { schema, tables } from './schema.js'
import * as WorkerSchema from './worker-schema.js'

class WorkerContext extends Context.Tag('WorkerContext')<
  WorkerContext,
  {
    store: Store<any>
    shutdownDeferred: ShutdownDeferred
  }
>() {}

const runner = WorkerRunner.layerSerialized(WorkerSchema.Request, {
  InitialMessage: ({ storeId, clientId, adapterType, params }) =>
    Effect.gen(function* () {
      const adapter =
        adapterType === 'file'
          ? makePersistedAdapter({
              schemaPath: new URL('./schema.js', import.meta.url).toString(),
              workerUrl: new URL('./livestore.worker.js', import.meta.url),
              baseDirectory: path.resolve(
                process.cwd(),
                `tmp`,
                new Date().toISOString().split('T')[0]!, // `YYYY-MM-DD`
                storeId,
                clientId,
              ),
              clientId,
            })
          : makeInMemoryAdapter({
              clientId,
              sync: { backend: makeCfSync({ url: `ws://localhost:${process.env.LIVESTORE_SYNC_PORT}` }) },
            })

      const shutdownDeferred = yield* Deferred.make<
        void,
        UnexpectedError | IntentionalShutdownCause | StoreInterrupted
      >()

      const store = yield* createStore({
        adapter,
        schema,
        storeId,
        disableDevtools: true,
        shutdownDeferred,
        params: { leaderPushBatchSize: params.leaderPushBatchSize },
      })
      // @ts-expect-error for debugging
      globalThis.store = store

      return Layer.succeed(WorkerContext, { store, shutdownDeferred })
    }).pipe(
      Effect.orDie,
      Effect.annotateLogs({ clientId }),
      Effect.annotateSpans({ clientId }),
      Effect.withSpan(`@livestore/adapter-node-sync:test:init-${clientId}`),
      Layer.unwrapScoped,
    ),
  CreateTodos: ({ count, commitBatchSize = 1 }) =>
    Effect.gen(function* () {
      // TODO check sync connection status
      const { store } = yield* WorkerContext
      const otelSpan = yield* OtelTracer.currentOtelSpan
      const mutationEventBatches = pipe(
        ReadonlyArray.range(0, count - 1),
        ReadonlyArray.map((i) => tables.todo.insert({ id: nanoid(), title: `todo ${i} (${clientId})` })),
        ReadonlyArray.chunksOf(commitBatchSize),
      )
      const spanLinks = [{ context: otelSpan.spanContext() }]
      for (const batch of mutationEventBatches) {
        store.commit({ spanLinks }, ...batch)
      }
    }).pipe(Effect.withSpan('@livestore/adapter-node-sync:test:create-todos', { attributes: { count } }), Effect.orDie),
  StreamTodos: () =>
    Effect.gen(function* () {
      const { store } = yield* WorkerContext
      const query$ = queryDb(tables.todo.query.orderBy('id', 'desc'))
      return store.subscribeStream(query$)
    }).pipe(Stream.unwrap, Stream.withSpan('@livestore/adapter-node-sync:test:stream-todos')),
  OnShutdown: () =>
    Effect.gen(function* () {
      const { shutdownDeferred } = yield* WorkerContext
      yield* shutdownDeferred.pipe(Effect.catchTag('LiveStore.StoreInterrupted', () => Effect.void))
    }).pipe(Effect.withSpan('@livestore/adapter-node-sync:test:on-shutdown')),
})

const clientId = process.argv[2]

const serviceName = `node-sync-test:${clientId}`

runner.pipe(
  Layer.provide(PlatformNode.NodeContext.layer),
  Layer.provide(ChildProcessRunner.layer),
  // Layer.provide(PlatformNode.NodeWorkerRunner.layer),
  WorkerRunner.launch,
  // TODO this parent span is currently missing in the trace
  Effect.withSpan(`@livestore/adapter-node-sync:run-worker-${clientId}`),
  Effect.provide(IS_CI ? OtelLiveDummy : OtelLiveHttp({ serviceName, skipLogUrl: true })),
  Effect.scoped,
  Effect.tapCauseLogPretty,
  Effect.annotateLogs({ thread: serviceName, clientId }),
  Effect.annotateSpans({ clientId }),
  Effect.provide(Logger.prettyWithThread(serviceName)),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  Effect.runFork,
)
