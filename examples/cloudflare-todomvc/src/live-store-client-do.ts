import { DurableObject, restore } from 'cloudflare:workers'
import type { AlarmInvocationInfo } from '@cloudflare/workers-types'

import { createStoreDoPromise, restoreStoreDoSyncTarget } from '@livestore/adapter-cloudflare'
import { nanoid, type Store } from '@livestore/livestore'

import { schema, tables } from './livestore/schema.ts'
import type { Env } from './shared.ts'
import { storeIdFromRequest } from './shared.ts'

export class LiveStoreClientDO extends DurableObject<Env> {
  private storeId: string | undefined
  private cachedStore!: Store<typeof schema>
  private hasCachedStore = false
  private storeSubscription: (() => void) | undefined

  async fetch(request: Request): Promise<Response> {
    this.storeId = storeIdFromRequest(request)

    const store = await this.getStore()

    await this.subscribeToStore()

    const todos = store.query(tables.todos)

    return new Response(JSON.stringify(todos, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async getStore() {
    if (this.hasCachedStore === true) {
      return this.cachedStore
    }

    const storeId = this.storeId!
    const store = await createStoreDoPromise({
      schema,
      storeId,
      clientId: 'client-do',
      sessionId: nanoid(),
      durableObject: { ctx: this.ctx },
      syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
      livePull: true,
    })

    this.cachedStore = store
    this.hasCachedStore = true

    return store
  }

  async subscribeToStore() {
    const store = await this.getStore()

    if (this.storeSubscription === undefined) {
      this.storeSubscription = store.subscribe(tables.todos, (todos) => {
        console.log(`todos for store (${this.storeId})`, todos)
      })
    }

    await this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  alarm(_alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
    this.subscribeToStore()
  }

  /** The sync backend delivers live updates through here; a rebuilt DO reloads its store first. */
  [restore](params: unknown) {
    return restoreStoreDoSyncTarget(this.ctx, params, {
      onUpdate: async (storeId) => {
        this.storeId = storeId
        await this.getStore()
      },
    })
  }
}
