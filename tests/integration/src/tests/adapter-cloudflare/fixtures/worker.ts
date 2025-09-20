/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { liveStoreStorageFormatVersion } from '@livestore/common'
import type { Store } from '@livestore/livestore'
import {
  type CfTypes,
  getSyncRequestSearchParams,
  handleSyncRequest,
  makeDurableObject,
  type SyncBackendRpcInterface,
} from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { events, schema, tables } from '../schema.ts'

type PersistenceSnapshot = {
  state: PersistenceCounts
  eventlog: PersistenceCounts
}

type PersistenceCounts = {
  files: number
  blocks: number
}

type ResetPersistenceSnapshot = {
  before: PersistenceSnapshot
  after: PersistenceSnapshot
}

type Env = {
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  TEST_STORE_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  DB: CfTypes.D1Database
  ADMIN_SECRET: string
}

export class SyncBackendDO extends makeDurableObject({}) {}

const DurableObjectBase = DurableObject as unknown as new (
  state: CfTypes.DurableObjectState,
  env: Env,
) => CfTypes.DurableObject

export class TestStoreDo extends DurableObjectBase implements ClientDoWithRpcCallback {
  private readonly ctx: CfTypes.DurableObjectState
  private readonly env: Env
  private cachedStore: Store<typeof schema> | undefined
  private cachedStoreId: string | undefined
  /** Captures the VFS counts immediately before/after a reset so tests can assert the deletion actually happened. */
  private lastResetSnapshot: ResetPersistenceSnapshot | undefined

  constructor(state: CfTypes.DurableObjectState, env: Env) {
    super(state, env)
    this.ctx = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const storeId = url.searchParams.get('storeId')

    if (storeId === null) {
      return new Response('storeId is required', { status: 400 })
    }

    if (url.pathname === '/store/todos') {
      if (request.method === 'POST') {
        const payload = (await request.json()) as { id?: string; title: string }
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

    return new Response('Not found', { status: 404 })
  }

  async syncUpdateRpc(payload: unknown) {
    await handleSyncUpdateRpc(payload)
  }

  private async ensureStore({
    storeId,
    resetPersistence,
  }: {
    storeId: string
    resetPersistence: boolean
  }): Promise<Store<typeof schema>> {
    // If the caller requested a reset (or we're handling a different store ID),
    // make sure to dispose the previous store instance so we can boot with a clean slate.
    const shouldRecreate = resetPersistence === true || this.cachedStore === undefined || this.cachedStoreId !== storeId

    if (shouldRecreate) {
      if (this.cachedStore !== undefined) {
        await this.cachedStore.shutdown()
      }

      const buildStore = () =>
        createStoreDoPromise({
          schema,
          storeId,
          clientId: 'integration-client',
          sessionId: crypto.randomUUID(),
          storage: this.ctx.storage,
          syncBackendDurableObject: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
          durableObjectId: this.ctx.id.toString(),
          bindingName: 'TEST_STORE_DO',
          resetPersistence,
        })

      let snapshotDuringReset: ResetPersistenceSnapshot | undefined

      if (resetPersistence) {
        const storage = this.ctx.storage
        const originalTransactionSync = storage.transactionSync

        // `resetPersistence: true` instructs the adapter to wipe vfs_* rows inside a
        // transaction. Intercept that call so the test can assert we saw the rows
        // disappear before the new store writes anything back.
        const wrappedTransactionSync: typeof originalTransactionSync = (closure) =>
          originalTransactionSync.call(storage, () => {
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
    return this.cachedStore
  }

  private getPersistenceSnapshot(): PersistenceSnapshot {
    const schemaHashSuffix =
      schema.state.sqlite.migrations.strategy === 'manual' ? 'fixed' : schema.state.sqlite.hash.toString()

    // The adapter stores SQLite data inside Durable Object persistence using the
    // liveStoreStorageFormatVersion as part of the VFS file path. Looking up
    // matching records lets the test confirm whether the reset logic wiped the
    // relevant rows.
    return {
      state: this.countPersistenceEntries(getStateDbFileName(schemaHashSuffix)),
      eventlog: this.countPersistenceEntries(getEventlogDbFileName()),
    }
  }

  private countPersistenceEntries(baseName: string): PersistenceCounts {
    const likePattern = `${baseName}%`

    return {
      files: this.countMatchingRecords('vfs_files', likePattern),
      blocks: this.countMatchingRecords('vfs_blocks', likePattern),
    }
  }

  private countMatchingRecords(table: 'vfs_files' | 'vfs_blocks', likePattern: string): number {
    const rows = this.ctx.storage.sql.exec(`SELECT COUNT(*) AS count FROM ${table} WHERE file_path LIKE ?`, likePattern)

    if (rows === undefined) {
      return 0
    }

    const [row] = Array.from(rows)

    return Number(row?.count ?? 0)
  }
}

export default {
  async fetch(request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) {
    const syncParams = getSyncRequestSearchParams(request)

    if (syncParams._tag === 'Some') {
      return handleSyncRequest({ request, searchParams: syncParams.value, env, ctx })
    }

    const url = new URL(request.url)

    if (url.pathname.startsWith('/store')) {
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

const getStateDbFileName = (suffix: string) => `state${suffix}@${liveStoreStorageFormatVersion}.db`

const getEventlogDbFileName = () => `eventlog@${liveStoreStorageFormatVersion}.db`
