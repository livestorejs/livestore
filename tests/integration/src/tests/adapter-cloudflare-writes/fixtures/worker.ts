/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'

import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import type { CfTypes } from '@livestore/common-cf'
import { CfDeclare } from '@livestore/common-cf/declare'
import type { Store } from '@livestore/livestore'
import {
  handleSyncRequest,
  makeDurableObject,
  matchSyncRequest,
  type SyncBackendRpcInterface,
} from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { shouldNeverHappen } from '@livestore/utils'

import { events, schema, tables } from '../schema.ts'

declare class Response extends CfDeclare.Response {}

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

export class WriteTrackingStoreDo extends DurableObject<Env> implements ClientDoWithRpcCallback {
  override __DURABLE_OBJECT_BRAND = 'WriteTrackingStoreDo' as never
  private cachedStore: Store<typeof schema> | undefined
  private cachedStoreId: string | undefined
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
        const store = await this.ensureStore({ storeId })

        store.commit(events.todoCreated({ id, title: payload.title }))

        return new Response(JSON.stringify({ id }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (request.method === 'GET') {
        const store = await this.ensureStore({ storeId })
        const todoList = store.query(tables.todos)

        return new Response(JSON.stringify(todoList), {
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response('Method not allowed', { status: 405 })
    }

    if (url.pathname === '/store/metrics') {
      if (request.method === 'GET') {
        await this.ensureStore({ storeId })

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
    // native-sqlite adapters capture storage.sql at init time, so the proxy
    // must be in place before any store is created and stay active for the
    // entire DO lifetime.
    this.trackedSql = wrapSqlForTracking(this.ctx.storage.sql)
    Object.defineProperty(this.ctx.storage, 'sql', {
      get: () => this.trackedSql,
      configurable: true,
    })
  }

  private async ensureStore({ storeId }: { storeId: string }): Promise<Store<typeof schema>> {
    this.ensureSqlTracking()

    if (this.cachedStore !== undefined && this.cachedStoreId === storeId) {
      return this.cachedStore
    }

    if (this.cachedStore !== undefined) {
      await this.cachedStore.shutdownPromise()
    }

    this.cachedStore = await createStoreDoPromise({
      schema,
      storeId,
      clientId: 'writes-test-client',
      sessionId: crypto.randomUUID(),
      durableObject: {
        ctx: this.ctx as CfTypes.DurableObjectState,
        env: this.env,
        bindingName: 'TEST_STORE_DO',
      },
      syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
    })

    this.cachedStoreId = storeId

    return this.cachedStore ?? shouldNeverHappen(`Store not initialized for storeId ${storeId}`)
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
