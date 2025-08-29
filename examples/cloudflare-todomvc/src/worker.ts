import { DurableObject } from 'cloudflare:workers'
import { type ClientDoWithRpcCallback, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc } from '@livestore/sync-cf/client'
import { schema, tables } from './livestore/schema.ts'

type Env = {
  CLIENT_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback>
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackend.SyncBackendRpcInterface>
  DB: D1Database
  ADMIN_SECRET: string
}

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  // onPush: async (message, { storeId }) => {
  //   console.log(`onPush for store (${storeId})`, message.batch)
  // },
}) {}

// Scoped by storeId
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

    // Kick off subscription to store
    await this.subscribeToStore()

    const todos = store.query(tables.todos)

    return new Response(JSON.stringify(todos, null, 2), { headers: { 'Content-Type': 'application/json' } })
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
    // Do whatever you like with the store here :)

    // Make sure to only subscribe once
    if (this.storeSubscription === undefined) {
      this.storeSubscription = store.subscribe(tables.todos, {
        onUpdate: (todos) => {
          console.log(`todos for store (${this.storeId})`, todos)
        },
      })
    }

    // Make sure the DO stays alive
    await this.state.storage.setAlarm(Date.now() + 1000)
  }

  alarm(_alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
    this.subscribeToStore()
  }

  async syncUpdateRpc(payload: unknown) {
    await handleSyncUpdateRpc(payload)
  }
}

export default {
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url)

    const requestParamsResult = SyncBackend.getSyncRequestSearchParams(request)

    if (requestParamsResult._tag === 'Some') {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams: requestParamsResult.value,
        env,
        ctx,
        options: { headers: {} },
      })
    }

    // Forward request to client DO
    if (url.pathname.endsWith('/client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.CLIENT_DO.idFromName(storeId)

      return env.CLIENT_DO.get(id).fetch(request)
    }

    if (url.pathname === '/') {
      // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
      return new Response('CloudFlare TodoMVC LiveStore Demo') as CfTypes.Response
    }

    // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
    return new Response('Invalid path', { status: 400 }) as CfTypes.Response
  },
} satisfies CfTypes.ExportedHandler<Env>

/// Helper functions

const storeIdFromRequest = (request: CfTypes.Request) => {
  const url = new URL(request.url)
  const storeId = url.searchParams.get('storeId')

  if (storeId === null) {
    throw new Error('storeId is required in URL search params')
  }

  return storeId
}
