/// <reference types="@cloudflare/workers-types" />

import { DurableObject, restore } from 'cloudflare:workers'

import { createStoreDoPromise, restoreStoreDoSyncTarget } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'

import type { Env } from './env.ts'
import { schema, tables } from './schema.ts'
import { storeIdFromRequest } from './shared.ts'

type AlarmInfo = {
  isRetry: boolean
  retryCount: number
}

export class LiveStoreClientDO extends DurableObject<Env> {
  private storeId: string | undefined
  private cachedStore: Store<typeof schema> | undefined
  private storeSubscription: Unsubscribe | undefined
  private readonly todosQuery = tables.todos.select()

  override async fetch(request: Request): Promise<Response> {
    // @ts-expect-error TODO remove casts once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
    this.storeId = storeIdFromRequest(request)

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
        // @ts-expect-error TODO remove once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
        ctx: this.ctx,
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
      this.storeSubscription = store.subscribe(this.todosQuery, (todos: ReadonlyArray<typeof tables.todos.Type>) => {
        console.log(`todos for store (${this.storeId})`, todos)
      })
    }

    await this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  override alarm(_alarmInfo?: AlarmInfo): void | Promise<void> {
    return this.subscribeToStore()
  }

  /** The sync backend delivers live updates through here; a rebuilt DO reloads its store first. */
  [restore](params: unknown) {
    // @ts-expect-error TODO remove once CF types are fixed in https://github.com/cloudflare/workerd/issues/4811
    return restoreStoreDoSyncTarget(this.ctx, params, {
      onUpdate: async (storeId) => {
        this.storeId = storeId
        await this.getStore()
      },
    })
  }
}
