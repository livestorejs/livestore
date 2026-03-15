/// <reference types="@cloudflare/workers-types" />

/**
 * Deployable CF worker for benchmarking livestore DO adapter write amplification
 * and memory usage under load.
 *
 * Endpoints (all require `?storeId=<id>` query param):
 *   POST /store/todos        — create a todo: { id, title }
 *   POST /store/todos/bulk   — create N todos: { count, prefix? }
 *   GET  /store/todos        — list all todos
 *   GET  /store/todos/count  — { count } (cheaper than listing all)
 *   GET  /store/metrics      — { totalRowsWritten, todoCount }
 *   DELETE /store/metrics    — reset rowsWritten counter
 *   POST /store/shutdown     — shut down the store (simulates cold start on next request)
 *   GET  /health             — health check (no storeId needed)
 *
 * Deploy:  cd tests/cf-bench && pnpm install && pnpm deploy
 * Local:   pnpm dev
 * Bench:   ./run-bench.sh <url>
 */

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

import { events, schema, tables } from './schema.ts'

declare class Response extends CfDeclare.Response {}

type Env = {
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  BENCH_STORE_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
}

export class SyncBackendDO extends makeDurableObject({}) {}

/** Wraps `storage.sql` to track `cursor.rowsWritten`. */
const wrapSqlForTracking = (sql: CfTypes.SqlStorage) => {
  let totalRowsWritten = 0

  const trackedExec: CfTypes.SqlStorage['exec'] = <T extends Record<string, CfTypes.SqlStorageValue>>(
    query: string,
    ...bindings: any[]
  ): CfTypes.SqlStorageCursor<T> => {
    const cursor = sql.exec<T>(query, ...bindings)
    totalRowsWritten += cursor.rowsWritten
    return cursor
  }

  return new Proxy(sql, {
    get(target, prop, receiver) {
      if (prop === 'exec') return trackedExec
      if (prop === 'totalRowsWritten') return totalRowsWritten
      if (prop === 'resetMetrics') {
        return () => {
          totalRowsWritten = 0
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as CfTypes.SqlStorage & { totalRowsWritten: number; resetMetrics: () => void }
}

export class BenchStoreDo extends DurableObject<Env> implements ClientDoWithRpcCallback {
  override __DURABLE_OBJECT_BRAND = 'BenchStoreDo' as never
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

    try {
      if (url.pathname === '/store/todos' && request.method === 'POST') {
        const payload = await request.json<{ id?: string; title: string }>()
        const id = payload.id ?? crypto.randomUUID()
        const store = await this.ensureStore({ storeId })
        store.commit(events.todoCreated({ id, title: payload.title }))
        return new Response(JSON.stringify({ id }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.pathname === '/store/todos/bulk' && request.method === 'POST') {
        const payload = await request.json<{ count: number; prefix?: string }>()
        const prefix = payload.prefix ?? 'todo'
        const store = await this.ensureStore({ storeId })
        for (let i = 0; i < payload.count; i++) {
          const id = `${prefix}-${i}-${crypto.randomUUID().slice(0, 6)}`
          store.commit(events.todoCreated({ id, title: `${prefix} item ${i}` }))
        }
        return new Response(JSON.stringify({ created: payload.count }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.pathname === '/store/todos' && request.method === 'GET') {
        const store = await this.ensureStore({ storeId })
        const todoList = store.query(tables.todos)
        return new Response(JSON.stringify(todoList), {
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.pathname === '/store/todos/count' && request.method === 'GET') {
        const store = await this.ensureStore({ storeId })
        const todoList = store.query(tables.todos)
        return new Response(JSON.stringify({ count: todoList.length }), {
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.pathname === '/store/metrics' && request.method === 'GET') {
        const store = await this.ensureStore({ storeId })
        const todoList = store.query(tables.todos)
        return new Response(
          JSON.stringify({
            totalRowsWritten: this.trackedSql?.totalRowsWritten ?? 0,
            todoCount: todoList.length,
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }

      if (url.pathname === '/store/metrics' && request.method === 'DELETE') {
        this.trackedSql?.resetMetrics()
        return new Response(JSON.stringify({ totalRowsWritten: 0 }), {
          headers: { 'content-type': 'application/json' },
        })
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  async syncUpdateRpc(payload: unknown) {
    await handleSyncUpdateRpc(payload)
  }

  private ensureSqlTracking() {
    if (this.trackedSql !== undefined) return
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
      clientId: 'bench-client',
      sessionId: crypto.randomUUID(),
      durableObject: {
        ctx: this.ctx as CfTypes.DurableObjectState,
        env: this.env,
        bindingName: 'BENCH_STORE_DO',
      },
      syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
    })

    this.cachedStoreId = storeId

    return this.cachedStore ?? shouldNeverHappen(`Store not initialized for storeId ${storeId}`)
  }
}

export default {
  async fetch(request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    }

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

    if (url.pathname.startsWith('/store') === true) {
      const storeId = url.searchParams.get('storeId')
      if (storeId === null) {
        return new Response('storeId query param is required', { status: 400 })
      }
      const id = env.BENCH_STORE_DO.idFromName(storeId)
      return env.BENCH_STORE_DO.get(id).fetch(request)
    }

    return new Response('Not found', { status: 404 })
  },
}
