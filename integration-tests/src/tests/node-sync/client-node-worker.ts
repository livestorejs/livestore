import './thread-polyfill.js'

import { createRequire } from 'node:module'
import path from 'node:path'

import type { Store } from '@livestore/livestore'
import { createStore, queryDb } from '@livestore/livestore'
import { makeNodeAdapter } from '@livestore/node'
import { Context, Effect, Layer, Logger, LogLevel, OtelTracer, Stream, WorkerRunner } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessRunner, OtelLiveHttp, PlatformNode } from '@livestore/utils/node'

import { schema, tables } from './schema.js'
import * as WorkerSchema from './worker-schema.js'

const moduleResolve = createRequire(import.meta.url).resolve

class WorkerContext extends Context.Tag('WorkerContext')<
  WorkerContext,
  {
    store: Store<any, any>
  }
>() {}

const runner = WorkerRunner.layerSerialized(WorkerSchema.Request, {
  InitialMessage: ({ storeId, clientId }) =>
    Effect.gen(function* () {
      const adapter = makeNodeAdapter({
        schemaPath: new URL('./schema.js', import.meta.url).toString(),
        // TODO bring back when fixed https://github.com/vitest-dev/vitest/issues/6953
        // makeSyncBackendUrl: import.meta.resolve('@livestore/sync-cf'),
        makeSyncBackendUrl: moduleResolve('@livestore/sync-cf'),
        baseDirectory: path.resolve(process.cwd(), 'tmp', clientId),
        syncOptions: {
          type: 'cf',
          url: 'ws://localhost:8787/websocket',
          roomId: `todomvc_${storeId}`,
        },
        otel: {
          workerServiceName: `node-sync-test:livestore-leader-${clientId}`,
        },
      })
      // const adapter = makeInMemoryAdapter()

      const store = yield* createStore({ adapter, schema, storeId, disableDevtools: true })

      return Layer.succeed(WorkerContext, { store })
    }).pipe(
      Effect.orDie,
      Effect.annotateLogs({ clientId }),
      Effect.annotateSpans({ clientId }),
      Effect.withSpan(`@livestore/node-sync:test:init-${clientId}`),
      Layer.unwrapScoped,
    ),
  CreateTodos: ({ count }) =>
    Effect.gen(function* () {
      // TODO check sync connection status
      const { store } = yield* WorkerContext
      const otelSpan = yield* OtelTracer.currentOtelSpan
      for (let i = 0; i < count; i++) {
        store.mutate(
          { spanLinks: [{ context: otelSpan.spanContext() }] },
          tables.todo.insert({ id: nanoid(), title: `todo ${i}` }),
        )
      }
    }).pipe(Effect.withSpan('@livestore/node-sync:test:create-todos', { attributes: { count } }), Effect.orDie),
  StreamTodos: () =>
    Stream.asyncPush<ReadonlyArray<typeof tables.todo.schema.Type>>((emit) =>
      Effect.gen(function* () {
        const query$ = queryDb(tables.todo.query.orderBy('id', 'desc').limit(10))

        const unsub = query$.subscribe((result) => emit.single(result))

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unsub()
            query$.destroy()
          }),
        )
      }),
    ).pipe(Stream.withSpan('@livestore/node-sync:test:stream-todos')),
})

const clientId = process.argv[2]

const serviceName = `node-sync-test:${clientId}`

runner.pipe(
  Layer.provide(PlatformNode.NodeContext.layer),
  Layer.provide(ChildProcessRunner.layer),
  // Layer.provide(PlatformNode.NodeWorkerRunner.layer),
  Layer.launch,
  // TODO this parent span is currently missing in the trace
  Effect.withSpan(`@livestore/node-sync:run-worker-${clientId}`),
  Effect.provide(OtelLiveHttp({ serviceName, skipLogUrl: true })),
  Effect.scoped,
  Effect.tapCauseLogPretty,
  Effect.annotateLogs({ thread: serviceName, clientId }),
  Effect.annotateSpans({ clientId }),
  Effect.provide(Logger.prettyWithThread(serviceName)),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  Effect.runFork,
)
