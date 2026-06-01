/// <reference types="@cloudflare/workers-types" />

/**
 * Sample app that reproduces the DO-RPC multi-chunk catchup stall.
 *
 * Topology mirrors a real LiveStore-on-Cloudflare deployment:
 *
 *   Test ──HTTP──▶ Worker ──▶ ClientStoreDo (LiveStore client over DO-RPC) ──DO-RPC──▶ SyncBackendDO
 *
 * The stall: when the client cold-boots behind the backend, it pulls the missing events as a single
 * multi-chunk streaming response over DO-RPC. The Cloudflare runtime splits that response across
 * several `reader.read()` chunks with msgpack frames straddling the boundaries. The unpatched
 * `processReadableStream` in `@livestore/common-cf` decodes each chunk individually, hands msgpackr
 * a truncated buffer, silently loses the tail, and the client's persisted sync head never catches
 * up — it stays frozen below the eventlog head forever.
 *
 * Repro recipe (see the test):
 *   1. bulk-commit N events and wait for them to sync (head == eventlogMax)
 *   2. shut the store down
 *   3. rewind the persisted sync head by K (so the client is now K events "behind" the backend)
 *   4. boot the store → it pulls the K-event gap as one multi-chunk catchup stream
 *   5. poll the sync head: it should climb back to eventlogMax (heal). With the bug it stays frozen.
 */

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

import { events, schema } from '../schema.ts'

const makeCfResponse = (...args: ConstructorParameters<typeof CfDeclare.Response>): CfTypes.Response =>
  new CfDeclare.Response(...args)

const json = (body: unknown, status = 200): CfTypes.Response =>
  makeCfResponse(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Env = {
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  CLIENT_STORE_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
}

const DurableObjectBase = DurableObject as any as new (
  state: CfTypes.DurableObjectState,
  env: Env,
) => CfTypes.DurableObject & { ctx: CfTypes.DurableObjectState; env: Env }

export class SyncBackendDO extends makeDurableObject({}) {}

export class ClientStoreDo extends DurableObjectBase implements ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND = 'ClientStoreDo' as never
  private cachedStore: Store<typeof schema> | undefined
  private cachedStoreId: string | undefined

  override async fetch(request: CfTypes.Request): Promise<CfTypes.Response> {
    const url = new URL(request.url)
    const storeId = url.searchParams.get('storeId')
    if (storeId === null) return json({ error: 'storeId is required' }, 400)

    // Commit `count` events in a single batched commit, then return the local eventlog head.
    if (url.pathname === '/store/bulk' && request.method === 'POST') {
      const count = Number(url.searchParams.get('count') ?? '500')
      const store = await this.ensureStore(storeId)
      const batch = Array.from({ length: count }, (_, i) => events.todoCreated({ id: crypto.randomUUID(), title: `item ${i}` }))
      store.commit(...batch)
      return json({ committed: count, ...this.readSyncStatus() })
    }

    // Read the persisted sync head + eventlog head directly from DO SQLite (no store boot required),
    // so the test can observe heal/stall without side effects.
    if (url.pathname === '/store/sync-status' && request.method === 'GET') {
      return json({ booted: this.cachedStore !== undefined, ...this.readSyncStatus() })
    }

    // Boot (or reuse) the store — this is what triggers the cold-boot catchup pull.
    if (url.pathname === '/store/boot' && request.method === 'POST') {
      await this.ensureStore(storeId)
      return json({ booted: true, ...this.readSyncStatus() })
    }

    if (url.pathname === '/store/shutdown' && request.method === 'POST') {
      if (this.cachedStore !== undefined) {
        await this.cachedStore.shutdownPromise()
        this.cachedStore = undefined
        this.cachedStoreId = undefined
      }
      return json({ ok: true })
    }

    return json({ error: 'not found' }, 404)
  }

  async syncUpdateRpc(payload: unknown) {
    await handleSyncUpdateRpc(payload)
  }

  /** Reads `__livestore_sync_status.head` and `MAX(eventlog.seqNumGlobal)` straight from DO SQLite. */
  private readSyncStatus(): { head: number; eventlogMax: number } {
    const head = this.queryNumber('SELECT head FROM __livestore_sync_status LIMIT 1')
    const eventlogMax = this.queryNumber('SELECT MAX(seqNumGlobal) AS v FROM eventlog')
    return { head, eventlogMax }
  }

  private queryNumber(query: string): number {
    try {
      const rows = this.ctx.storage.sql.exec<Record<string, unknown>>(query)
      const [row] = Array.from(rows)
      const value = row === undefined ? 0 : Number(Object.values(row)[0] ?? 0)
      return Number.isFinite(value) ? value : 0
    } catch {
      return 0
    }
  }

  private async ensureStore(storeId: string): Promise<Store<typeof schema>> {
    if (this.cachedStore !== undefined && this.cachedStoreId === storeId) return this.cachedStore

    if (this.cachedStore !== undefined) await this.cachedStore.shutdownPromise()

    this.cachedStore = await createStoreDoPromise({
      schema,
      storeId,
      clientId: 'stall-repro-client',
      sessionId: crypto.randomUUID(),
      durableObject: { ctx: this.ctx, env: this.env, bindingName: 'CLIENT_STORE_DO' },
      syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
      resetPersistence: false,
    })
    this.cachedStoreId = storeId

    return this.cachedStore ?? shouldNeverHappen(`Store not initialized for storeId ${storeId}`)
  }
}

export default {
  async fetch(request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) {
    const syncParams = matchSyncRequest(request)
    if (syncParams !== undefined) {
      return handleSyncRequest({ request, searchParams: syncParams, env, ctx, syncBackendBinding: 'SYNC_BACKEND_DO' })
    }

    const url = new URL(request.url)
    if (url.pathname.startsWith('/store') === true) {
      const storeId = url.searchParams.get('storeId')
      if (storeId === null) return makeCfResponse('storeId is required', { status: 400 })
      const id = env.CLIENT_STORE_DO.idFromName(storeId)
      return env.CLIENT_STORE_DO.get(id).fetch(request)
    }

    return makeCfResponse('Not found', { status: 404 })
  },
}
