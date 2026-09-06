import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
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

const { WranglerDevServer } = await import('@livestore/utils-dev/wrangler')

const withTestCtx = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    Layer.mergeAll(
      WranglerDevServer.layer({
        cwd: fixturesDir,
        readiness: { connectTimeout: Duration.seconds(15) },
      }).pipe(Layer.provide(Layer.mergeAll(PlatformNode.NodeServices.layer, FetchHttpClient.layer))),
      FetchHttpClient.layer,
    ),
})

const PersistenceSnapshotSchema = Schema.Struct({
  state: Schema.Struct({ count: Schema.Finite }),
  eventlog: Schema.Struct({ count: Schema.Finite }),
})

const ResetPersistenceSnapshotSchema = Schema.Struct({
  before: PersistenceSnapshotSchema,
  after: PersistenceSnapshotSchema,
})

const RebuildResponseSchema = Schema.Struct({
  todos: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  attemptedEvents: Schema.Array(Schema.String),
  attemptedHooks: Schema.Array(Schema.String),
  instanceId: Schema.String,
})

const readRebuildResponse = HttpClientResponse.schemaBodyJson(RebuildResponseSchema)

const makeStoreHelpers = (serverUrl: string, storeId: string) =>
  Effect.gen(function* () {
    const rawClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest((req) =>
        req.pipe(HttpClientRequest.prependUrl(serverUrl), HttpClientRequest.setUrlParam('storeId', storeId)),
      ),
    )
    const client = HttpClient.filterStatusOk(rawClient)

    return {
      // Recovery tests deliberately inspect failed boot responses.
      rebuild: (params: Record<string, string>) => rawClient.post('/store/rebuild', { urlParams: params }),
      blockCleanup: () => client.post('/store/rebuild/block-cleanup'),
      unblockCleanup: () => client.del('/store/rebuild/block-cleanup'),
      rebuildFiles: (seedUnrelated = false) =>
        (seedUnrelated === true ? client.post('/store/rebuild/files') : client.get('/store/rebuild/files')).pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              Schema.Array(Schema.Struct({ path: Schema.String, pages: Schema.Finite })),
            ),
          ),
        ),
      rebuildEventlog: () =>
        client
          .get('/store/rebuild/eventlog')
          .pipe(
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                Schema.Struct({ events: Schema.Array(Schema.Json), sync: Schema.Array(Schema.Json) }),
              ),
            ),
          ),
      createTodo: (id: string, title: string) =>
        HttpClientRequest.post('/store/todos').pipe(
          HttpClientRequest.bodyJson({ id, title }),
          Effect.flatMap(client.execute),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ id: Schema.String }))),
        ),

      listTodos: () =>
        client
          .get('/store/todos')
          .pipe(
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
              ),
            ),
          ),

      getPersistenceSnapshot: () =>
        client.get('/store/persistence').pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ persistence: PersistenceSnapshotSchema }))),
          Effect.map((_) => _.persistence),
        ),

      resetStore: () =>
        client.post('/store/reset').pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              Schema.Struct({
                todos: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
                persistence: PersistenceSnapshotSchema,
                resetSnapshot: Schema.Union([Schema.Null, ResetPersistenceSnapshotSchema]),
              }),
            ),
          ),
        ),

      getMetrics: () =>
        client
          .get('/store/metrics')
          .pipe(
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                Schema.Struct({ totalRowsWritten: Schema.Finite, totalRowsRead: Schema.Finite }),
              ),
            ),
          ),

      resetMetrics: () =>
        client
          .del('/store/metrics')
          .pipe(
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                Schema.Struct({ totalRowsWritten: Schema.Finite, totalRowsRead: Schema.Finite }),
              ),
            ),
          ),

      shutdownStore: () =>
        client
          .post('/store/shutdown')
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ ok: Schema.Boolean })))),
    }
  })

Vitest.describe('adapter-cloudflare', { timeout: testTimeout }, () => {
  for (const failure of ['replay', 'post', 'abort']) {
    Vitest.live(`removes obsolete state only after successful rebuild following ${failure} (#1555)`, (test) =>
      Effect.gen(function* () {
        const server = yield* WranglerDevServer.WranglerDevServer
        const { rebuild, rebuildFiles, rebuildEventlog, resetMetrics, getMetrics } = yield* makeStoreHelpers(
          server.url,
          `cf-stale-state-${nanoid(6)}`,
        )
        const seeded = yield* rebuild({ seed: 'true' })
        expect(seeded.status).toBe(200)
        const seedBody = yield* readRebuildResponse(seeded)
        const before = yield* rebuildEventlog()
        const originalFiles = yield* rebuildFiles()
        expect(originalFiles).toHaveLength(1)
        const oldState = originalFiles[0]!
        const unrelated = { path: '/unrelated.db', pages: 1 }
        yield* rebuildFiles(true)

        const failed = yield* rebuild(
          failure === 'replay' ? { failAt: 'todo-3' } : { post: failure === 'post' ? 'fail' : 'abort' },
        )
        expect(failed.status).toBe(500)
        const failedFiles = yield* rebuildFiles()
        expect(failedFiles).toContainEqual(oldState)
        expect(failedFiles).toContainEqual(unrelated)
        expect(yield* rebuildEventlog()).toEqual(before)

        const recovered = yield* rebuild({ post: 'complete' })
        expect(recovered.status).toBe(200)
        const recoveredBody = yield* readRebuildResponse(recovered)
        expect(recoveredBody.todos).toEqual([{ id: 'post-hook', title: 'completed' }, ...seedBody.todos])
        expect(recoveredBody.attemptedEvents).toHaveLength(5)
        expect(yield* rebuildEventlog()).toEqual(before)
        const retainedFiles = yield* rebuildFiles()
        expect(retainedFiles).toHaveLength(2)
        expect(retainedFiles).toContainEqual(unrelated)
        expect(retainedFiles.some(({ path }) => path === oldState.path)).toBe(false)
        yield* Effect.promise(() => test.annotate(`Removed ${oldState.pages} obsolete VFS pages`))

        yield* resetMetrics()
        const reopened = yield* rebuild({ post: 'fail' })
        expect(reopened.status).toBe(200)
        expect(yield* readRebuildResponse(reopened)).toMatchObject({
          todos: recoveredBody.todos,
          attemptedEvents: [],
          attemptedHooks: [],
        })
        expect(yield* rebuildFiles()).toEqual(retainedFiles)
        expect((yield* getMetrics()).totalRowsWritten).toBe(0)
      }).pipe(withTestCtx(test)),
    )
  }

  Vitest.live('retries rejected cleanup on completed-state reopen without replay (#1555)', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServer.WranglerDevServer
      const { rebuild, rebuildFiles, rebuildEventlog, blockCleanup, unblockCleanup } = yield* makeStoreHelpers(
        server.url,
        `cf-cleanup-retry-${nanoid(6)}`,
      )
      expect((yield* rebuild({ seed: 'true' })).status).toBe(200)
      const completed = yield* rebuild({ post: 'complete' })
      expect(completed.status).toBe(200)
      const { todos } = yield* readRebuildResponse(completed)
      const files = yield* rebuildFiles()
      const eventlog = yield* rebuildEventlog()
      yield* blockCleanup()

      const blocked = yield* rebuild({ post: 'fail' })
      expect(blocked.status).toBe(200)
      expect(yield* readRebuildResponse(blocked)).toMatchObject({ todos, attemptedEvents: [], attemptedHooks: [] })
      expect(yield* rebuildFiles()).toContainEqual({ path: '/state-obsolete@0.db', pages: 1 })

      yield* unblockCleanup()
      const retried = yield* rebuild({ post: 'fail' })
      expect(retried.status).toBe(200)
      expect(yield* readRebuildResponse(retried)).toMatchObject({ todos, attemptedEvents: [], attemptedHooks: [] })
      expect(yield* rebuildFiles()).toEqual(files)
      expect(yield* rebuildEventlog()).toEqual(eventlog)
    }).pipe(withTestCtx(test)),
  )

  for (const eventCount of [250, 1000]) {
    Vitest.live(`schema rebuild stays within the write budget for ${eventCount} events (#1555)`, (test) =>
      Effect.gen(function* () {
        const server = yield* WranglerDevServer.WranglerDevServer
        const { rebuild, rebuildEventlog, getMetrics, resetMetrics } = yield* makeStoreHelpers(
          server.url,
          `cf-replay-writes-${nanoid(6)}`,
        )
        const seeded = yield* rebuild({ seed: 'true', seedCount: String(eventCount) })
        expect(seeded.status).toBe(200)
        const seedBody = yield* readRebuildResponse(seeded)
        expect(seedBody.todos).toHaveLength(eventCount)
        expect((yield* getMetrics()).totalRowsWritten).toBeGreaterThan(0)
        const eventlogBefore = yield* rebuildEventlog()
        expect(eventlogBefore.events).toHaveLength(eventCount)

        yield* resetMetrics()
        const rebuilt = yield* rebuild({ post: 'complete' })
        expect(rebuilt.status).toBe(200)
        const rebuiltBody = yield* readRebuildResponse(rebuilt)
        const { totalRowsWritten } = yield* getMetrics()
        expect(rebuiltBody.todos).toEqual([{ id: 'post-hook', title: 'completed' }, ...seedBody.todos])
        expect(rebuiltBody.attemptedEvents).toEqual(Array.from({ length: eventCount }, (_, i) => `todo-${i + 1}`))
        expect(rebuiltBody.attemptedHooks).toEqual(['init', 'pre', 'post'])
        expect(yield* rebuildEventlog()).toEqual(eventlogBefore)

        yield* resetMetrics()
        const reopened = yield* rebuild({ post: 'fail' })
        expect(reopened.status).toBe(200)
        expect(yield* readRebuildResponse(reopened)).toMatchObject({
          todos: rebuiltBody.todos,
          attemptedEvents: [],
          attemptedHooks: [],
        })
        expect((yield* getMetrics()).totalRowsWritten).toBe(0)

        yield* Effect.promise(() => test.annotate(`${totalRowsWritten} rebuild writes for ${eventCount} events`))
        expect(totalRowsWritten).toBeGreaterThan(0)
        expect(totalRowsWritten).toBeLessThanOrEqual(eventCount * 5)
      }).pipe(withTestCtx(test)),
    )
  }

  Vitest.live('retries an interrupted schema rebuild instead of serving partial state (#1605)', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServer.WranglerDevServer
      const storeId = `cf-rebuild-${nanoid(6)}`
      const { rebuild: request, rebuildEventlog: eventlog } = yield* makeStoreHelpers(server.url, storeId)
      const expected = Array.from({ length: 5 }, (_, i) => ({ id: `todo-${i + 1}`, title: `item ${i + 1}` }))

      const seeded = yield* request({ seed: 'true' })
      expect(seeded.status).toBe(200)
      const seededBody = yield* readRebuildResponse(seeded)
      expect(seededBody).toMatchObject({ todos: expected })

      const before = yield* eventlog()
      expect(before.events).toHaveLength(5)

      // The table rename forces replay into a new persisted state database.
      const failed = yield* request({ failAt: 'todo-3' })
      expect(failed.status).toBe(500)
      expect(yield* failed.json).toMatchObject({
        attemptedEvents: ['todo-1', 'todo-2', 'todo-3'],
      })

      const failedAgain = yield* request({ failAt: 'todo-3' })
      expect(failedAgain.status).toBe(500)
      expect(yield* failedAgain.json).toMatchObject({
        attemptedEvents: ['todo-1', 'todo-2', 'todo-3'],
      })

      const recovered = yield* request({})
      expect(recovered.status).toBe(200)
      expect(yield* recovered.json).toMatchObject({ todos: expected })
      expect(yield* eventlog()).toEqual(before)

      const reused = yield* request({ failAt: 'todo-1' })
      expect(reused.status).toBe(200)
      expect(yield* reused.json).toMatchObject({ todos: expected, attemptedEvents: [] })
    }).pipe(withTestCtx(test)),
  )

  for (const post of ['fail', 'abort'] as const) {
    Vitest.live(`retries a rebuild after post-hook ${post}, without publishing partial state (#1605)`, (test) =>
      Effect.gen(function* () {
        const server = yield* WranglerDevServer.WranglerDevServer
        const storeId = `cf-rebuild-post-${nanoid(6)}`
        const { rebuild: request } = yield* makeStoreHelpers(server.url, storeId)
        const seeded = yield* request({ seed: 'true' })
        expect(seeded.status).toBe(200)
        const seedBody = yield* readRebuildResponse(seeded)

        const failed = yield* request({ post })
        expect(failed.status).toBe(500)
        if (post === 'fail') {
          expect(yield* failed.json).toMatchObject({
            attemptedEvents: ['todo-1', 'todo-2', 'todo-3', 'todo-4', 'todo-5'],
            attemptedHooks: ['init', 'pre', 'post'],
          })
        } else {
          expect(yield* failed.text).toContain('Rebuild fixture aborted during post hook')
        }

        const recovered = yield* request({ post: 'complete' })
        expect(recovered.status).toBe(200)
        const recoveredBody = yield* readRebuildResponse(recovered)
        expect(recoveredBody).toMatchObject({
          todos: [{ id: 'post-hook', title: 'completed' }, ...seedBody.todos],
          attemptedEvents: ['todo-1', 'todo-2', 'todo-3', 'todo-4', 'todo-5'],
          attemptedHooks: ['init', 'pre', 'post'],
        })
        if (post === 'abort') expect(recoveredBody.instanceId).not.toBe(seedBody.instanceId)

        const reused = yield* request({ post: 'fail' })
        expect(reused.status).toBe(200)
        expect(yield* reused.json).toMatchObject({
          todos: recoveredBody.todos,
          attemptedEvents: [],
          attemptedHooks: [],
        })
      }).pipe(withTestCtx(test)),
    )
  }

  Vitest.live('records completion for an empty eventlog and does not repeat hooks (#1605)', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServer.WranglerDevServer
      const storeId = `cf-rebuild-empty-${nanoid(6)}`
      const { rebuild: request } = yield* makeStoreHelpers(server.url, storeId)
      const first = yield* request({ post: 'complete' })
      expect(first.status).toBe(200)
      const firstBody = yield* readRebuildResponse(first)
      expect(firstBody).toMatchObject({
        todos: [{ id: 'post-hook', title: 'completed' }],
        attemptedEvents: [],
        attemptedHooks: ['init', 'pre', 'post'],
      })
      const reused = yield* request({ post: 'fail' })
      expect(reused.status).toBe(200)
      expect(yield* reused.json).toMatchObject({
        todos: firstBody.todos,
        attemptedEvents: [],
        attemptedHooks: [],
      })
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('keeps Durable Object state when resetPersistence is not requested', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServer.WranglerDevServer
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
      const server = yield* WranglerDevServer.WranglerDevServer
      const storeId = `cf-reset-${nanoid(6)}`
      const { createTodo, listTodos, getPersistenceSnapshot, resetStore } = yield* makeStoreHelpers(server.url, storeId)

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
      const server = yield* WranglerDevServer.WranglerDevServer
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
      const server = yield* WranglerDevServer.WranglerDevServer
      const storeId = `cf-writes-snapshot-restore-${nanoid(6)}`
      const { createTodo, listTodos, getMetrics, resetMetrics, shutdownStore } = yield* makeStoreHelpers(
        server.url,
        storeId,
      )

      const todos = Array.from({ length: 5 }, (_, i) => ({ id: `todo-${i}`, title: `item ${i}` }))
      yield* Effect.forEach(todos, ({ id, title }) => createTodo(id, title), { concurrency: 1 })

      const preShutdownTodos = yield* listTodos()
      expect(preShutdownTodos).toHaveLength(todos.length)

      // Let blocking sync acknowledge seeded events before measuring an idle reopen.
      yield* shutdownStore()
      expect(yield* listTodos()).toEqual(preShutdownTodos)
      yield* shutdownStore()
      yield* resetMetrics()

      const postRestartTodos = yield* listTodos()
      expect(postRestartTodos).toHaveLength(todos.length)

      expect(postRestartTodos.map((t) => t.id)).toEqual(expect.arrayContaining(todos.map((t) => t.id)))

      const restartMetrics = yield* getMetrics()

      // Cold start with VFS-backed state should be cheap — just reopens the VFS.
      // The eventlog is on DO SQLite directly (1 row per event).
      expect(restartMetrics.totalRowsRead).toBeGreaterThan(0)
      expect(restartMetrics.totalRowsRead).toBeLessThan(50)
      expect(restartMetrics.totalRowsWritten).toBe(0)

      yield* Effect.promise(() =>
        test.annotate(`${restartMetrics.totalRowsWritten} writes, ${restartMetrics.totalRowsRead} reads on cold start`),
      )
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('data survives multiple shutdown cycles', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServer.WranglerDevServer
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
      const server = yield* WranglerDevServer.WranglerDevServer
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

      yield* Effect.promise(() => test.annotate(`${writesPerTodo.toFixed(1)} writes/todo after cold start`))
    }).pipe(withTestCtx(test)),
  )
})
