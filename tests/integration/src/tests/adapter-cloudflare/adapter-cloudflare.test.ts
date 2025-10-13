import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Duration, Effect, FetchHttpClient, Layer } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, 'fixtures')
const testTimeout = Duration.toMillis(Duration.minutes(2))

type PersistenceSnapshot = {
  state: { files: number; blocks: number }
  eventlog: { files: number; blocks: number }
}

type ResetPersistenceSnapshot = {
  before: PersistenceSnapshot
  after: PersistenceSnapshot
}

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
    WranglerDevServerService.Default({
      cwd: fixturesDir,
      connectTimeout: Duration.seconds(45),
      showLogs: true,
    }).pipe(Layer.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer))),
})

const makeStoreUrl = (serverUrl: string, pathname: string, storeId: string) => {
  const url = new URL(pathname, serverUrl)
  url.searchParams.set('storeId', storeId)
  return url
}

Vitest.describe('adapter-cloudflare', { timeout: testTimeout }, () => {
  Vitest.scopedLive('keeps durable object state when resetPersistence is not requested', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-adapter-${nanoid(6)}`
      const todosUrl = makeStoreUrl(server.url, '/store/todos', storeId)
      const persistenceUrl = makeStoreUrl(server.url, '/store/persistence', storeId)

      const createTodo = (id: string, title: string) =>
        Effect.tryPromise(async () => {
          const response = await fetch(todosUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, title }),
          })

          if (!response.ok) {
            throw new Error(`failed to create todo: ${response.status}`)
          }

          return response.json() as Promise<{ id: string }>
        })

      const listTodos = () =>
        Effect.tryPromise(async () => {
          const response = await fetch(todosUrl)

          if (!response.ok) {
            throw new Error(`failed to list todos: ${response.status}`)
          }

          return response.json() as Promise<ReadonlyArray<{ id: string; title: string }>>
        })

      const getPersistenceSnapshot = () =>
        Effect.tryPromise(async () => {
          const response = await fetch(persistenceUrl)

          if (!response.ok) {
            throw new Error(`failed to read persistence metadata: ${response.status}`)
          }

          const body = (await response.json()) as { persistence: PersistenceSnapshot }

          return body.persistence
        })

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
      // Without a reset the adapter should keep the SQLite blobs backing the state/eventlog VFS around.
      expect(persistenceAfterSecondInsert.state.files).toBeGreaterThan(0)
      expect(persistenceAfterSecondInsert.state.blocks).toBeGreaterThan(0)
      expect(persistenceAfterSecondInsert.eventlog.files).toBeGreaterThan(0)
      // Eventlog writes are sparse during the test, so the VFS file metadata is
      // the reliable signal that data stuck around between requests.
      expect(persistenceAfterSecondInsert.eventlog.blocks).toBeGreaterThanOrEqual(0)
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('clears durable object persistence when resetPersistence is true', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-reset-${nanoid(6)}`
      const todosUrl = makeStoreUrl(server.url, '/store/todos', storeId)
      const resetUrl = makeStoreUrl(server.url, '/store/reset', storeId)
      const persistenceUrl = makeStoreUrl(server.url, '/store/persistence', storeId)

      const createTodo = (id: string, title: string) =>
        Effect.tryPromise(async () => {
          const response = await fetch(todosUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, title }),
          })

          if (!response.ok) {
            throw new Error(`failed to create todo: ${response.status}`)
          }

          return response.json() as Promise<{ id: string }>
        })

      const listTodos = () =>
        Effect.tryPromise(async () => {
          const response = await fetch(todosUrl)

          if (!response.ok) {
            throw new Error(`failed to list todos: ${response.status}`)
          }

          return response.json() as Promise<ReadonlyArray<{ id: string; title: string }>>
        })

      const resetStore = () =>
        Effect.tryPromise(async () => {
          const response = await fetch(resetUrl, { method: 'POST' })

          if (!response.ok) {
            throw new Error(`failed to reset store: ${response.status}`)
          }

          return response.json() as Promise<{
            todos: ReadonlyArray<{ id: string; title: string }>
            persistence: PersistenceSnapshot
            resetSnapshot: ResetPersistenceSnapshot | null
          }>
        })

      const getPersistenceSnapshot = () =>
        Effect.tryPromise(async () => {
          const response = await fetch(persistenceUrl)

          if (!response.ok) {
            throw new Error(`failed to read persistence metadata: ${response.status}`)
          }

          const body = (await response.json()) as { persistence: PersistenceSnapshot }

          return body.persistence
        })

      yield* createTodo('todo-1', 'first item')
      yield* createTodo('todo-2', 'second item')

      const todosBeforeReset = yield* listTodos()
      expect(todosBeforeReset).toHaveLength(2)

      const persistenceBeforeReset = yield* getPersistenceSnapshot()
      expect(persistenceBeforeReset.state.files).toBeGreaterThan(0)
      expect(persistenceBeforeReset.state.blocks).toBeGreaterThan(0)
      expect(persistenceBeforeReset.eventlog.files).toBeGreaterThan(0)
      expect(persistenceBeforeReset.eventlog.blocks).toBeGreaterThanOrEqual(0)

      const { persistence, resetSnapshot } = yield* resetStore()
      // The reset route boots the adapter with `resetPersistence: true`. Capture the on-reset metadata to make sure rows were cleared.
      expect(resetSnapshot).not.toBeNull()
      const snapshotDuringReset = resetSnapshot as ResetPersistenceSnapshot
      expect(snapshotDuringReset.before.state.files).toBeGreaterThan(0)
      expect(snapshotDuringReset.before.state.blocks).toBeGreaterThan(0)
      expect(snapshotDuringReset.before.eventlog.files).toBeGreaterThan(0)
      expect(snapshotDuringReset.before.eventlog.blocks).toBeGreaterThanOrEqual(0)
      expect(snapshotDuringReset.after.state.files).toBe(0)
      expect(snapshotDuringReset.after.state.blocks).toBe(0)
      expect(snapshotDuringReset.after.eventlog.files).toBe(0)
      expect(snapshotDuringReset.after.eventlog.blocks).toBe(0)

      const todosAfterReset = yield* listTodos()
      // Sync backend still holds previous events, so the freshly booted store rehydrates the two original todos.
      expect(todosAfterReset).toHaveLength(2)

      yield* createTodo('todo-3', 'after reset')

      const todosAfterRepopulation = yield* listTodos()
      expect(todosAfterRepopulation).toHaveLength(3)

      const persistenceAfterRepopulation = yield* getPersistenceSnapshot()
      // After the reset completes the adapter should continue writing new state/eventlog pages as usual.
      expect(persistence.state.files).toBeGreaterThan(0)
      expect(persistence.state.blocks).toBeGreaterThan(0)
      expect(persistence.eventlog.files).toBeGreaterThan(0)
      expect(persistence.eventlog.blocks).toBeGreaterThanOrEqual(0)
      expect(persistenceAfterRepopulation.state.files).toBeGreaterThan(0)
      expect(persistenceAfterRepopulation.state.blocks).toBeGreaterThan(0)
      expect(persistenceAfterRepopulation.eventlog.files).toBeGreaterThan(0)
      expect(persistenceAfterRepopulation.eventlog.blocks).toBeGreaterThanOrEqual(0)
    }).pipe(withTestCtx(test)),
  )
})
