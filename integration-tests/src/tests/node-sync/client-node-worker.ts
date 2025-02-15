import './thread-polyfill.js'

import path from 'node:path'

import type { Store } from '@livestore/livestore'
import { createStore, queryDb } from '@livestore/livestore'
import { makeInMemoryAdapter, makeNodeAdapter } from '@livestore/node'
import { makeWsSync } from '@livestore/sync-cf'
import { IS_CI } from '@livestore/utils'
import { Context, Effect, Layer, Logger, LogLevel, OtelTracer, Stream, WorkerRunner } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { ChildProcessRunner, OtelLiveDummy, OtelLiveHttp, PlatformNode } from '@livestore/utils/node'

import { schema, tables } from './schema.js'
import * as WorkerSchema from './worker-schema.js'

class WorkerContext extends Context.Tag('WorkerContext')<
  WorkerContext,
  {
    store: Store<any, any>
  }
>() {}

const runner = WorkerRunner.layerSerialized(WorkerSchema.Request, {
  InitialMessage: ({ storeId, clientId, adapterType }) =>
    Effect.gen(function* () {
      const adapter =
        adapterType === 'file'
          ? makeNodeAdapter({
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
              sync: {
                makeBackend: ({ storeId }) => makeWsSync({ url: 'ws://localhost:8888', storeId }),
              },
            })

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
    Effect.gen(function* () {
      const { store } = yield* WorkerContext
      const query$ = queryDb(tables.todo.query.orderBy('id', 'desc').limit(10))
      return store.subscribeStream(query$)
    }).pipe(Stream.unwrap, Stream.withSpan('@livestore/node-sync:test:stream-todos')),
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
  Effect.provide(IS_CI ? OtelLiveDummy : OtelLiveHttp({ serviceName, skipLogUrl: true })),
  Effect.scoped,
  Effect.tapCauseLogPretty,
  Effect.annotateLogs({ thread: serviceName, clientId }),
  Effect.annotateSpans({ clientId }),
  Effect.provide(Logger.prettyWithThread(serviceName)),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  Effect.runFork,
)
