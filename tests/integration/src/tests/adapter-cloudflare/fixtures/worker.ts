/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'

import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { CfDeclare } from '@livestore/common-cf/declare'
import type { Store } from '@livestore/livestore'
import {
  type CfTypes,
  handleSyncRequest,
  makeDurableObject,
  matchSyncRequest,
  type SyncBackendRpcInterface,
} from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { shouldNeverHappen } from '@livestore/utils'

import { events, schema, tables } from '../schema.ts'

declare class Response extends CfDeclare.Response {}

type PersistenceSnapshot = {
  state: PersistenceCounts
  eventlog: PersistenceCounts
}

type PersistenceCounts = {
  count: number
}

type ResetPersistenceSnapshot = {
  before: PersistenceSnapshot
  after: PersistenceSnapshot
}

type Env = {
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  TEST_STORE_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
}

export class SyncBackendDO extends makeDurableObject({}) {}

/**
 * Wraps `storage.sql` to intercept every `exec()` call and accumulate
 * `cursor.rowsWritten` after iteration. This gives us exact write counts
 * without modifying any adapter code.
 */
const wrapSqlForTracking = (sql: CfTypes.SqlStorage) => {
  let totalRowsWritten = 0
  let totalRowsRead = 0

  const trackedExec: CfTypes.SqlStorage['exec'] = <T extends Record<string, CfTypes.SqlStorageValue>>(
    query: string,
    ...bindings: any[]
  ): CfTypes.SqlStorageCursor<T> => {
    const cursor = sql.exec<T>(query, ...bindings)

    // Track rowsWritten immediately — CF cursors expose the count as a
    // property on the cursor object right after exec() returns, before
    // iteration. Most VFS write operations (INSERT, UPDATE, DELETE) never
    // iterate the cursor, so we must capture the count eagerly.
    totalRowsWritten += cursor.rowsWritten
    totalRowsRead += cursor.rowsRead

    return cursor
  }

  const trackedSql = new Proxy(sql, {
    get(target, prop, receiver) {
      if (prop === 'exec') return trackedExec
      if (prop === 'totalRowsWritten') return totalRowsWritten
      if (prop === 'totalRowsRead') return totalRowsRead
      if (prop === 'resetMetrics') {
        return () => {
          totalRowsWritten = 0
          totalRowsRead = 0
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as CfTypes.SqlStorage & { totalRowsWritten: number; totalRowsRead: number; resetMetrics: () => void }

  return trackedSql
}

export class TestStoreDo extends DurableObject<Env> implements ClientDoWithRpcCallback {
  override __DURABLE_OBJECT_BRAND = 'TestStoreDo' as never
  private cachedStore: Store<typeof schema> | undefined
  private cachedStoreId: string | undefined
  /** Captures the VFS counts immediately before/after a reset so tests can assert the deletion actually happened. */
  private lastResetSnapshot: ResetPersistenceSnapshot | undefined
  private trackedSql: ReturnType<typeof wrapSqlForTracking> | undefined

  // @ts-expect-error - Type mismatch due to different Request/Response types across workspaces
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const storeId = url.searchParams.get('storeId')

    if (storeId === null) {
      return new Response('storeId is required', { status: 400 })
    }

    if (url.pathname === '/store/todos') {
      if (request.method === 'POST') {
        const payload = await request.json<{ id?: string; title: string }>()
        const id = payload.id ?? crypto.randomUUID()
        const store = await this.ensureStore({ storeId, resetPersistence: false })

        store.commit(events.todoCreated({ id, title: payload.title }))

        return new Response(JSON.stringify({ id }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (request.method === 'GET') {
        const store = await this.ensureStore({ storeId, resetPersistence: false })
        const todos = store.query(tables.todos)

        return new Response(JSON.stringify(todos), {
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response('Method not allowed', { status: 405 })
    }

    if (url.pathname === '/store/persistence' && request.method === 'GET') {
      // Expose the persistence metadata without mutating it so tests can
      // compare the counts before and after the reset-only flow.
      await this.ensureStore({ storeId, resetPersistence: false })

      const persistence = this.getPersistenceSnapshot()

      return new Response(JSON.stringify({ persistence }), {
        headers: { 'content-type': 'application/json' },
      })
    }

    if (url.pathname === '/store/reset' && request.method === 'POST') {
      const store = await this.ensureStore({ storeId, resetPersistence: true })
      const todos = store.query(tables.todos)
      const persistence = this.getPersistenceSnapshot()
      const resetSnapshot = this.lastResetSnapshot ?? null

      return new Response(
        JSON.stringify({
          todos,
          persistence,
          resetSnapshot,
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    if (url.pathname === '/store/metrics') {
      if (request.method === 'GET') {
        await this.ensureStore({ storeId, resetPersistence: false })

        return new Response(
          JSON.stringify({
            totalRowsWritten: this.trackedSql?.totalRowsWritten ?? 0,
            totalRowsRead: this.trackedSql?.totalRowsRead ?? 0,
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }

      if (request.method === 'DELETE') {
        this.trackedSql?.resetMetrics()

        return new Response(JSON.stringify({ totalRowsWritten: 0, totalRowsRead: 0 }), {
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response('Method not allowed', { status: 405 })
    }

    if (url.pathname === '/store/shutdown' && request.method === 'POST') {
      if (this.cachedStore !== undefined) {
        await this.cachedStore.shutdownPromise()
        this.cachedStore = undefined
        this.cachedStoreId = undefined
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  async syncUpdateRpc(payload: unknown) {
    await handleSyncUpdateRpc(payload)
  }

  private ensureSqlTracking() {
    if (this.trackedSql !== undefined) return

    // Install the tracking proxy on storage.sql permanently. The VFS and
    // DO SQLite adapters capture storage.sql at init time, so the proxy
    // must be in place before any store is created and stay active for the
    // entire DO lifetime.
    this.trackedSql = wrapSqlForTracking(this.ctx.storage.sql)
    Object.defineProperty(this.ctx.storage, 'sql', {
      get: () => this.trackedSql,
      configurable: true,
    })
  }

  private async ensureStore({
    storeId,
    resetPersistence,
  }: {
    storeId: string
    resetPersistence: boolean
  }): Promise<Store<typeof schema>> {
    this.ensureSqlTracking()

    // If the caller requested a reset (or we're handling a different store ID),
    // make sure to dispose the previous store instance so we can boot with a clean slate.
    const shouldRecreate = resetPersistence || this.cachedStore === undefined || this.cachedStoreId !== storeId

    if (shouldRecreate === true) {
      if (this.cachedStore !== undefined) {
        await this.cachedStore.shutdownPromise()
      }

      const buildStore = () =>
        createStoreDoPromise({
          schema,
          storeId,
          clientId: 'integration-client',
          sessionId: crypto.randomUUID(),
          durableObject: { ctx: this.ctx as CfTypes.DurableObjectState, env: this.env, bindingName: 'TEST_STORE_DO' },
          syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
          resetPersistence,
        })

      let snapshotDuringReset: ResetPersistenceSnapshot | undefined

      if (resetPersistence === true) {
        const storage = this.ctx.storage
        const originalTransactionSync = storage.transactionSync
        const invokeOriginalTransactionSync = <T>(callback: () => T): T =>
          originalTransactionSync.call(storage, callback) as T

        // `resetPersistence: true` instructs the adapter to wipe vfs_* rows inside a
        // transaction. Intercept that call so the test can assert we saw the rows
        // disappear before the new store writes anything back.
        const wrappedTransactionSync: CfTypes.DurableObjectStorage['transactionSync'] = <T>(closure: () => T) =>
          invokeOriginalTransactionSync(() => {
            if (snapshotDuringReset !== undefined) {
              return closure()
            }

            const before = this.getPersistenceSnapshot()
            try {
              return closure()
            } finally {
              const after = this.getPersistenceSnapshot()
              snapshotDuringReset = { before, after }
            }
          })

        storage.transactionSync = wrappedTransactionSync

        try {
          this.cachedStore = await buildStore()
        } finally {
          storage.transactionSync = originalTransactionSync
        }
      } else {
        this.cachedStore = await buildStore()
      }

      this.cachedStoreId = storeId
      this.lastResetSnapshot = snapshotDuringReset
    }

    // Returning the cached store lets subsequent calls reuse the same instance
    // without touching persistence unless a reset is requested explicitly.
    return this.cachedStore ?? shouldNeverHappen(`Store not initialized for storeId ${storeId}`)
  }

  private getPersistenceSnapshot(): PersistenceSnapshot {
    // Single vfs_pages table — no file_path filtering needed.
    // "state" counts VFS pages (dbState), "eventlog" counts DO SQLite eventlog rows.
    return {
      state: this.countVfsPages(),
      eventlog: this.countEventlogRows(),
    }
  }

  private countVfsPages(): PersistenceCounts {
    try {
      const rows = this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM vfs_pages')
      const [row] = Array.from(rows)
      return { count: Number(row?.count ?? 0) }
    } catch {
      return { count: 0 }
    }
  }

  private countEventlogRows(): PersistenceCounts {
    try {
      const rows = this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM eventlog')
      const [row] = Array.from(rows)
      return { count: Number(row?.count ?? 0) }
    } catch {
      return { count: 0 }
    }
  }
}

export default {
  async fetch(request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) {
    const syncParams = matchSyncRequest(request)

    if (syncParams !== undefined) {
      return handleSyncRequest({
        request,
        searchParams: syncParams,
        env,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
      })
    }

    const url = new URL(request.url)

    if (url.pathname.startsWith('/store') === true) {
      const storeId = url.searchParams.get('storeId')
      if (storeId === null) {
        return new Response('storeId is required', { status: 400 })
      }

      const id = env.TEST_STORE_DO.idFromName(storeId)
      return env.TEST_STORE_DO.get(id).fetch(request)
    }

    return new Response('Not found', { status: 404 })
  },
}
