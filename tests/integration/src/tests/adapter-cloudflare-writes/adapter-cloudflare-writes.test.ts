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
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, 'fixtures')
const testTimeout = Duration.toMillis(Duration.minutes(2))

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
  Vitest.live('verifies low rowsWritten with native eventlog and in-memory state DB', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-writes-${nanoid(6)}`
      const { createTodo, listTodos, getMetrics, resetMetrics } = yield* makeStoreHelpers(server.url, storeId)

      yield* createTodo('boot-todo', 'initial boot')

      const bootMetrics = yield* getMetrics()
      yield* Effect.log('[optimized] rowsWritten after boot + first todo:', bootMetrics.totalRowsWritten)

      yield* resetMetrics()

      const todoCount = 10
      for (let i = 0; i < todoCount; i++) {
        yield* createTodo(`todo-${i}`, `item ${i}`)
      }

      const steadyStateMetrics = yield* getMetrics()
      const writesPerTodo = steadyStateMetrics.totalRowsWritten / todoCount

      yield* Effect.log('[optimized] rowsWritten for', todoCount, 'todos:', steadyStateMetrics.totalRowsWritten)
      yield* Effect.log('[optimized] rowsWritten per todo:', writesPerTodo)

      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(todoCount + 1)
      expect(writesPerTodo).toBeLessThan(20)

      yield* Effect.log('[optimized] Writes per todo:', writesPerTodo.toFixed(1), '(down from ~238 with VFS-backed storage)')
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('snapshot restore on cold start avoids full rematerialization', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-snapshot-${nanoid(6)}`
      const { createTodo, listTodos, getMetrics, resetMetrics, shutdownStore } = yield* makeStoreHelpers(
        server.url,
        storeId,
      )

      const todoCount = 5
      for (let i = 0; i < todoCount; i++) {
        yield* createTodo(`todo-${i}`, `item ${i}`)
      }

      const preShutdownTodos = yield* listTodos()
      expect(preShutdownTodos).toHaveLength(todoCount)

      yield* shutdownStore()
      yield* resetMetrics()

      const postRestartTodos = yield* listTodos()
      expect(postRestartTodos).toHaveLength(todoCount)

      for (let i = 0; i < todoCount; i++) {
        expect(postRestartTodos.find((t) => t.id === `todo-${i}`)).toBeDefined()
      }

      const restartMetrics = yield* getMetrics()
      yield* Effect.log('[snapshot-restore] rowsWritten on cold start:', restartMetrics.totalRowsWritten)

      // Snapshot restore should be much cheaper than full rematerialization.
      // Full rematerialization of 5 events with VFS would cost ~1000+ writes.
      // With snapshot restore + native eventlog, expect under 50.
      expect(restartMetrics.totalRowsWritten).toBeLessThan(50)
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('data survives multiple shutdown cycles', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-cycles-${nanoid(6)}`
      const { createTodo, listTodos, shutdownStore } = yield* makeStoreHelpers(server.url, storeId)

      yield* createTodo('todo-a', 'first cycle')
      yield* shutdownStore()

      yield* createTodo('todo-b', 'second cycle')
      yield* shutdownStore()

      yield* createTodo('todo-c', 'third cycle')

      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(3)
      expect(allTodos.find((t) => t.id === 'todo-a')).toBeDefined()
      expect(allTodos.find((t) => t.id === 'todo-b')).toBeDefined()
      expect(allTodos.find((t) => t.id === 'todo-c')).toBeDefined()
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('steady-state writes remain low after cold start', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-post-restart-${nanoid(6)}`
      const { createTodo, listTodos, getMetrics, resetMetrics, shutdownStore } = yield* makeStoreHelpers(
        server.url,
        storeId,
      )

      yield* createTodo('seed-todo', 'seed')
      yield* shutdownStore()

      // Reboot and let snapshot restore
      yield* createTodo('post-restart-boot', 'boot after restart')
      yield* resetMetrics()

      const todoCount = 5
      for (let i = 0; i < todoCount; i++) {
        yield* createTodo(`post-restart-${i}`, `item ${i}`)
      }

      const metrics = yield* getMetrics()
      const writesPerTodo = metrics.totalRowsWritten / todoCount

      yield* Effect.log('[post-restart] rowsWritten per todo:', writesPerTodo.toFixed(1))

      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(todoCount + 2) // seed + boot + N
      expect(writesPerTodo).toBeLessThan(20)
    }).pipe(withTestCtx(test)),
  )
})
