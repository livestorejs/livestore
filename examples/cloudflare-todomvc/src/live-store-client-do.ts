import { DurableObject } from 'cloudflare:workers'
import type { AlarmInvocationInfo } from '@cloudflare/workers-types'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import type { Env } from './env.ts'
import { storeIdFromRequest } from './env.ts'
import { schema, tables } from './livestore/schema.ts'

export class LiveStoreClientDO extends DurableObject implements ClientDoWithRpcCallback {
  private storeId: string | undefined
  private cachedStore: Store<typeof schema> | undefined
  private storeSubscription: Unsubscribe | undefined

  constructor(
    readonly state: DurableObjectState,
    readonly env: Env,
  ) {
    super(state, env)
  }

  async fetch(request: Request): Promise<Response> {
    // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
    this.storeId = storeIdFromRequest(request)

    const store = await this.getStore()

    await this.subscribeToStore()

    const todos = store.query(tables.todos)

    return new Response(JSON.stringify(todos, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async getStore() {
    if (this.cachedStore !== undefined) {
      return this.cachedStore
    }

    const storeId = this.storeId!
    const store = await createStoreDoPromise({
      schema,
      storeId,
      clientId: 'client-do',
      sessionId: nanoid(),
      durableObjectId: this.state.id.toString(),
      bindingName: 'CLIENT_DO',
      storage: this.state.storage,
      syncBackendDurableObject: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
      livePull: true,
    })

    this.cachedStore = store

    return store
  }

  async subscribeToStore() {
    const store = await this.getStore()

    if (this.storeSubscription === undefined) {
      this.storeSubscription = store.subscribe(tables.todos, {
        onUpdate: (todos) => {
          console.log(`todos for store (${this.storeId})`, todos)
        },
      })
    }

    await this.state.storage.setAlarm(Date.now() + 1000)
  }

  alarm(_alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
    this.subscribeToStore()
  }

  async syncUpdateRpc(payload: unknown) {
    await handleSyncUpdateRpc(payload)
  }
}
