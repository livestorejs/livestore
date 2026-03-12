import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Duration,
  Effect,
  FetchHttpClient,
  HttpClient, HttpClientRequest,
  HttpClientResponse,
  Layer,
  Schema
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, 'fixtures')
const testTimeout = Duration.toMillis(Duration.seconds(45))

delete process.env.HTTP_PROXY
delete process.env.http_proxy
delete process.env.HTTPS_PROXY
delete process.env.https_proxy
delete process.env.ALL_PROXY
delete process.env.all_proxy

const { WranglerDevServerService } = await import('@livestore/utils-dev/wrangler')

const withTestCtx = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    Layer.mergeAll(
      WranglerDevServerService.Default({
        cwd: fixturesDir,
        readiness: { connectTimeout: Duration.seconds(45) },
        showLogs: true,
      }).pipe(
        Layer.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer)),
      ),
      FetchHttpClient.layer,
    ),
})

const makeStoreHelpers = (serverUrl: string, storeId: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest((req) =>
        req.pipe(
          HttpClientRequest.prependUrl(serverUrl),
          HttpClientRequest.setUrlParam('storeId', storeId),
        ),
      ),
      HttpClient.filterStatusOk,
    )

    return {
      createTodo: (id: string, title: string) =>
        HttpClientRequest.post('/store/todos').pipe(
          HttpClientRequest.bodyJson({ id, title }),
          Effect.flatMap(client.execute),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ id: Schema.String })))
        ),

      listTodos: () => client.get('/store/todos').pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })))),
      ),

      getMetrics: () => client.get('/store/metrics').pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ totalRowsWritten: Schema.Number }))),
      ),

      resetMetrics: () => client.del('/store/metrics').pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ totalRowsWritten: Schema.Number }))),
      ),

      shutdownStore: () => client.post('/store/shutdown').pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ ok: Schema.Boolean }))),
      ),
    }
  })

Vitest.describe('adapter-cloudflare-writes', { timeout: testTimeout }, () => {
  Vitest.live('rows written is below 20 per todo created', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = 'cf-writes-steady-state'
      const { createTodo, listTodos, getMetrics, resetMetrics } = yield* makeStoreHelpers(server.url, storeId)

      // Boot the store and discard initial write overhead so we measure steady-state only.
      yield* createTodo('boot-todo', 'initial boot')
      yield* resetMetrics()

      const todos = Array.from({ length: 10 }, (_, i) => ({ id: `todo-${i}`, title: `item ${i}` }))
      yield* Effect.forEach(todos, ({ id, title }) => createTodo(id, title), { concurrency: 1 })

      const steadyStateMetrics = yield* getMetrics()
      const writesPerTodo = steadyStateMetrics.totalRowsWritten / todos.length

      yield* Effect.log('[optimized] rowsWritten for', todos.length, 'todos:', steadyStateMetrics.totalRowsWritten)
      yield* Effect.log('[optimized] rowsWritten per todo:', writesPerTodo)

      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(todos.length + 1)
      expect(writesPerTodo).toBeGreaterThan(0)
      expect(writesPerTodo).toBeLessThan(20)

      yield* Effect.log('[optimized] Writes per todo:', writesPerTodo.toFixed(1), '(down from ~238 with VFS-backed storage)')
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('snapshot restore on cold start avoids full rematerialization', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = 'cf-writes-snapshot-restore'
      const { createTodo, listTodos, getMetrics, resetMetrics, shutdownStore } = yield* makeStoreHelpers(
        server.url,
        storeId,
      )

      const todos = Array.from({ length: 5 }, (_, i) => ({ id: `todo-${i}`, title: `item ${i}` }))
      yield* Effect.forEach(todos, ({ id, title }) => createTodo(id, title), { concurrency: 1 })

      const preShutdownTodos = yield* listTodos()
      expect(preShutdownTodos).toHaveLength(todos.length)

      yield* shutdownStore()
      yield* resetMetrics()

      const postRestartTodos = yield* listTodos()
      expect(postRestartTodos).toHaveLength(todos.length)

      expect(postRestartTodos.map((t) => t.id)).toEqual(expect.arrayContaining(todos.map((t) => t.id)))

      const restartMetrics = yield* getMetrics()
      yield* Effect.log('[snapshot-restore] rowsWritten on cold start:', restartMetrics.totalRowsWritten)

      // Snapshot restore should be much cheaper than full rematerialization.
      // Full rematerialization of 5 events with VFS would cost ~1000+ writes.
      // With snapshot restore + native eventlog, expect under 50.
      expect(restartMetrics.totalRowsWritten).toBeGreaterThan(0)
      expect(restartMetrics.totalRowsWritten).toBeLessThan(50)
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('data survives multiple shutdown cycles', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = 'cf-writes-multi-cycle'
      const { createTodo, listTodos, shutdownStore } = yield* makeStoreHelpers(server.url, storeId)

      yield* createTodo('todo-a', 'first cycle')
      yield* shutdownStore()

      yield* createTodo('todo-b', 'second cycle')
      yield* shutdownStore()

      yield* createTodo('todo-c', 'third cycle')

      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(3)
      expect(allTodos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'todo-a', title: 'first cycle' }),
          expect.objectContaining({ id: 'todo-b', title: 'second cycle' }),
          expect.objectContaining({ id: 'todo-c', title: 'third cycle' }),
        ]),
      )
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('rows written is below 20 per todo created after cold start', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = 'cf-writes-post-restart'
      const { createTodo, listTodos, getMetrics, resetMetrics, shutdownStore } = yield* makeStoreHelpers(
        server.url,
        storeId,
      )

      yield* createTodo('seed-todo', 'seed')
      yield* shutdownStore()

      // Reboot and let snapshot restore
      yield* createTodo('post-restart-boot', 'boot after restart')
      yield* resetMetrics()

      const todos = Array.from({ length: 5 }, (_, i) => ({ id: `post-restart-${i}`, title: `item ${i}` }))
      yield* Effect.forEach(todos, ({ id, title }) => createTodo(id, title), { concurrency: 1 })

      const metrics = yield* getMetrics()
      const writesPerTodo = metrics.totalRowsWritten / todos.length

      yield* Effect.log('[post-restart] rowsWritten per todo:', writesPerTodo.toFixed(1))

      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(todos.length + 2) // seed + boot + N
      expect(writesPerTodo).toBeGreaterThan(0)
      expect(writesPerTodo).toBeLessThan(20)
    }).pipe(withTestCtx(test)),
  )
})
