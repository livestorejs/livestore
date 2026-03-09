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
      readiness: { connectTimeout: Duration.seconds(45) },
      showLogs: true,
    }).pipe(Layer.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer))),
})

const makeStoreUrl = (serverUrl: string, pathname: string, storeId: string) => {
  const url = new URL(pathname, serverUrl)
  url.searchParams.set('storeId', storeId)
  return url
}

Vitest.describe('adapter-cloudflare-writes', { timeout: testTimeout }, () => {
  Vitest.scopedLive('measures rowsWritten baseline for VFS-backed storage', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-writes-${nanoid(6)}`

      const createTodo = (id: string, title: string) =>
        Effect.tryPromise(async () => {
          const url = makeStoreUrl(server.url, '/store/todos', storeId)
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, title }),
          })

          if (response.ok !== true) {
            throw new Error(`failed to create todo: ${response.status} ${await response.text()}`)
          }

          return response.json<{ id: string }>()
        })

      const listTodos = () =>
        Effect.tryPromise(async () => {
          const url = makeStoreUrl(server.url, '/store/todos', storeId)
          const response = await fetch(url)

          if (response.ok !== true) {
            throw new Error(`failed to list todos: ${response.status}`)
          }

          return response.json<ReadonlyArray<{ id: string; title: string }>>()
        })

      const getMetrics = () =>
        Effect.tryPromise(async () => {
          const url = makeStoreUrl(server.url, '/store/metrics', storeId)
          const response = await fetch(url)

          if (response.ok !== true) {
            throw new Error(`failed to read metrics: ${response.status}`)
          }

          return response.json<{ totalRowsWritten: number }>()
        })

      const resetMetrics = () =>
        Effect.tryPromise(async () => {
          const url = makeStoreUrl(server.url, '/store/metrics', storeId)
          const response = await fetch(url, { method: 'DELETE' })

          if (response.ok !== true) {
            throw new Error(`failed to reset metrics: ${response.status}`)
          }

          return response.json<{ totalRowsWritten: number }>()
        })

      // Boot the store — this triggers initial materialization and VFS setup.
      // The boot itself incurs writes (VFS table creation, schema setup, etc.).
      yield* createTodo('boot-todo', 'initial boot')

      const bootMetrics = yield* getMetrics()
      console.log('[baseline] rowsWritten after boot + first todo:', bootMetrics.totalRowsWritten)

      // Reset counter to measure steady-state writes per todo
      yield* resetMetrics()

      const todoCount = 10

      for (let i = 0; i < todoCount; i++) {
        yield* createTodo(`todo-${i}`, `item ${i}`)
      }

      const steadyStateMetrics = yield* getMetrics()
      const writesPerTodo = steadyStateMetrics.totalRowsWritten / todoCount

      console.log('[baseline] rowsWritten for', todoCount, 'todos:', steadyStateMetrics.totalRowsWritten)
      console.log('[baseline] rowsWritten per todo:', writesPerTodo)

      // Verify todos were actually created correctly
      const allTodos = yield* listTodos()
      expect(allTodos).toHaveLength(todoCount + 1) // +1 for boot todo

      // Assert VFS write amplification: each todo should cause significantly
      // more than 1 row written due to VFS block splitting (64 KiB blocks in
      // vfs_blocks table). Measured baseline: ~238x amplification per event
      // (both dbState and dbEventlog go through VFS).
      // We use a conservative threshold to avoid flaky tests while still
      // catching any accidental improvement or regression.
      expect(writesPerTodo).toBeGreaterThan(50)

      console.log(
        '[baseline] Write amplification factor:',
        `${writesPerTodo.toFixed(1)}x`,
        '(measured baseline: ~238x for VFS-backed storage)',
      )
    }).pipe(withTestCtx(test)),
  )
})
