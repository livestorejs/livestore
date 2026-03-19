import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Duration,
  Effect,
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Layer,
  Schema,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, 'fixtures')
const testTimeout = Duration.toMillis(Duration.seconds(45))

// Wrangler refuses to start when proxy environment variables are set, which can
// happen in CI. Clearing them keeps the dev server reachable during tests.
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
        readiness: { connectTimeout: Duration.seconds(15) },
      }).pipe(Layer.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer))),
      FetchHttpClient.layer,
    ),
})

const PersistenceSnapshotSchema = Schema.Struct({
  state: Schema.Struct({ count: Schema.Number }),
  eventlog: Schema.Struct({ count: Schema.Number }),
})

const ResetPersistenceSnapshotSchema = Schema.Struct({
  before: PersistenceSnapshotSchema,
  after: PersistenceSnapshotSchema,
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
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ id: Schema.String }))),
        ),

      listTodos: () =>
        client.get('/store/todos').pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
            ),
          ),
        ),

      getPersistenceSnapshot: () =>
        client.get('/store/persistence').pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(Schema.Struct({ persistence: PersistenceSnapshotSchema })),
          ),
          Effect.map((_) => _.persistence),
        ),

      resetStore: () =>
        client.post('/store/reset').pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              Schema.Struct({
                todos: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
                persistence: PersistenceSnapshotSchema,
                resetSnapshot: Schema.Union(Schema.Null, ResetPersistenceSnapshotSchema),
              }),
            ),
          ),
        ),

      getMetrics: () =>
        client.get('/store/metrics').pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              Schema.Struct({ totalRowsWritten: Schema.Number, totalRowsRead: Schema.Number }),
            ),
          ),
        ),

      resetMetrics: () =>
        client.del('/store/metrics').pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              Schema.Struct({ totalRowsWritten: Schema.Number, totalRowsRead: Schema.Number }),
            ),
          ),
        ),

      shutdownStore: () =>
        client.post('/store/shutdown').pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ ok: Schema.Boolean }))),
        ),
    }
  })

Vitest.describe('adapter-cloudflare', { timeout: testTimeout }, () => {
  Vitest.live('keeps Durable Object state when resetPersistence is not requested', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-adapter-${nanoid(6)}`
      const { createTodo, listTodos, getPersistenceSnapshot } = yield* makeStoreHelpers(server.url, storeId)

      yield* createTodo('todo-1', 'first item')

      const initialTodos = yield* listTodos()
      expect(initialTodos).toEqual([{ id: 'todo-1', title: 'first item' }])

      yield* createTodo('todo-2', 'second item')

      const todosAfterSecondInsert = yield* listTodos()
      expect(todosAfterSecondInsert).toEqual([
        { id: 'todo-1', title: 'first item' },
        { id: 'todo-2', title: 'second item' },
      ])

      const persistenceAfterSecondInsert = yield* getPersistenceSnapshot()
      // Without a reset the adapter should keep the VFS pages backing the state around.
      expect(persistenceAfterSecondInsert.state.count).toBeGreaterThan(0)
      expect(persistenceAfterSecondInsert.eventlog.count).toBeGreaterThan(0)
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('clears Durable Object persistence when resetPersistence is true', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-reset-${nanoid(6)}`
      const { createTodo, listTodos, getPersistenceSnapshot, resetStore } = yield* makeStoreHelpers(
        server.url,
        storeId,
      )

      yield* createTodo('todo-1', 'first item')
      yield* createTodo('todo-2', 'second item')

      const todosBeforeReset = yield* listTodos()
      expect(todosBeforeReset).toHaveLength(2)

      const persistenceBeforeReset = yield* getPersistenceSnapshot()
      expect(persistenceBeforeReset.state.count).toBeGreaterThan(0)
      expect(persistenceBeforeReset.eventlog.count).toBeGreaterThan(0)

      const { persistence, resetSnapshot } = yield* resetStore()
      // The reset route boots the adapter with `resetPersistence: true`. Capture the on-reset metadata to make sure rows were cleared.
      expect(resetSnapshot).not.toBeNull()
      const snapshotDuringReset = resetSnapshot!
      expect(snapshotDuringReset.before.state.count).toBeGreaterThan(0)
      expect(snapshotDuringReset.before.eventlog.count).toBeGreaterThan(0)
      expect(snapshotDuringReset.after.state.count).toBe(0)
      expect(snapshotDuringReset.after.eventlog.count).toBe(0)

      const todosAfterReset = yield* listTodos()
      // Sync backend still holds previous events, so the freshly booted store rehydrates the two original todos.
      expect(todosAfterReset).toHaveLength(2)

      yield* createTodo('todo-3', 'after reset')

      const todosAfterRepopulation = yield* listTodos()
      expect(todosAfterRepopulation).toHaveLength(3)

      const persistenceAfterRepopulation = yield* getPersistenceSnapshot()
      // After the reset completes the adapter should continue writing new state/eventlog pages as usual.
      expect(persistence.state.count).toBeGreaterThan(0)
      expect(persistence.eventlog.count).toBeGreaterThan(0)
      expect(persistenceAfterRepopulation.state.count).toBeGreaterThan(0)
      expect(persistenceAfterRepopulation.eventlog.count).toBeGreaterThan(0)
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('rows written is below 20 per todo created', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-writes-steady-state-${nanoid(6)}`
      const { createTodo, listTodos, getMetrics, resetMetrics } = yield* makeStoreHelpers(server.url, storeId)

      // Boot the store and discard initial write overhead so we measure steady-state only.
      yield* createTodo('boot-todo', 'initial boot')
      yield* resetMetrics()

      const todos = Array.from({ length: 10 }, (_, i) => ({ id: `todo-${i}`, title: `item ${i}` }))
      yield* Effect.forEach(todos, ({ id, title }) => createTodo(id, title), { concurrency: 1 })

      const steadyStateMetrics = yield* getMetrics()
      const writesPerTodo = steadyStateMetrics.totalRowsWritten / todos.length

      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(todos.length + 1)
      expect(writesPerTodo).toBeGreaterThan(0)
      expect(writesPerTodo).toBeLessThan(20)

      yield* Effect.promise(() =>
        test.annotate(
          `${writesPerTodo.toFixed(1)} writes/todo (total: ${steadyStateMetrics.totalRowsWritten} for ${todos.length} todos)`,
        ),
      )
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('cold start reopens persisted VFS state with zero writes', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-writes-snapshot-restore-${nanoid(6)}`
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

      // Cold start with VFS-backed state should be cheap — just reopens the VFS.
      // The eventlog is on native DO SQLite (1 row per event).
      expect(restartMetrics.totalRowsRead).toBeGreaterThan(0)
      expect(restartMetrics.totalRowsRead).toBeLessThan(50)
      expect(restartMetrics.totalRowsWritten).toBe(0)

      yield* Effect.promise(() =>
        test.annotate(
          `${restartMetrics.totalRowsWritten} writes, ${restartMetrics.totalRowsRead} reads on cold start`,
        ),
      )
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('data survives multiple shutdown cycles', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-writes-multi-cycle-${nanoid(6)}`
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
      const storeId = `cf-writes-post-restart-${nanoid(6)}`
      const { createTodo, listTodos, getMetrics, resetMetrics, shutdownStore } = yield* makeStoreHelpers(
        server.url,
        storeId,
      )

      yield* createTodo('seed-todo', 'seed')
      yield* shutdownStore()

      // Reboot — VFS-backed state persists automatically
      yield* createTodo('post-restart-boot', 'boot after restart')
      yield* resetMetrics()

      const todos = Array.from({ length: 5 }, (_, i) => ({ id: `post-restart-${i}`, title: `item ${i}` }))
      yield* Effect.forEach(todos, ({ id, title }) => createTodo(id, title), { concurrency: 1 })

      const metrics = yield* getMetrics()
      const writesPerTodo = metrics.totalRowsWritten / todos.length

      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(todos.length + 2) // seed + boot + N
      expect(writesPerTodo).toBeGreaterThan(0)
      expect(writesPerTodo).toBeLessThan(20)

      yield* Effect.promise(() =>
        test.annotate(`${writesPerTodo.toFixed(1)} writes/todo after cold start`),
      )
    }).pipe(withTestCtx(test)),
  )
})
