/// <reference path="./types.d.ts" />

import { DurableObject } from 'cloudflare:workers'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import type { Env } from './env.ts'
import { schema, tables } from './schema.ts'
import { storeIdFromRequest } from './shared.ts'

type AlarmInfo = {
  isRetry: boolean
  retryCount: number
}

export class LiveStoreClientDO extends DurableObject<Env> implements ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND: never = undefined as never

  private storeId: string | undefined
  private cachedStore: Store<typeof schema> | undefined
  private storeSubscription: Unsubscribe | undefined
  private readonly todosQuery = tables.todos.select()

  async fetch(request: Request): Promise<Response> {
    this.storeId = storeIdFromRequest(request as unknown as CfTypes.Request)

    const store = await this.getStore()
    await this.subscribeToStore()

    const todos = store.query(this.todosQuery)
    return new Response(JSON.stringify(todos, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async getStore() {
    if (this.cachedStore !== undefined) {
      return this.cachedStore
    }

    const storeId = this.storeId ?? nanoid()

    const store = await createStoreDoPromise({
      schema,
      storeId,
      clientId: 'client-do',
      sessionId: nanoid(),
      durableObject: {
        ctx: this.ctx as CfTypes.DurableObjectState,
        env: this.env,
        bindingName: 'CLIENT_DO',
      },
      syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
      livePull: true,
    })

    this.cachedStore = store
    return store
  }

  private async subscribeToStore() {
    const store = await this.getStore()

    if (this.storeSubscription === undefined) {
      this.storeSubscription = store.subscribe(this.todosQuery, {
        onUpdate: (todos: ReadonlyArray<typeof tables.todos.Type>) => {
          console.log(`todos for store (${this.storeId})`, todos)
        },
      })
    }

    await this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  alarm(_alarmInfo?: AlarmInfo): void | Promise<void> {
    return this.subscribeToStore()
  }

  async syncUpdateRpc(payload: unknown) {
    await handleSyncUpdateRpc(payload)
  }
}
