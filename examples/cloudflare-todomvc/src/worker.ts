import { DurableObject } from 'cloudflare:workers'
import { createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { nanoid, type Store, type Unsubscribe } from '@livestore/livestore'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { schema, tables } from './livestore/schema.ts'

type Env = {
  CLIENT_DO: DurableObjectNamespace<SyncBackend.ClientDOInterface>
  SYNC_BACKEND_DO: DurableObjectNamespace<SyncBackend.SyncBackendRpcInterface>
  DB: D1Database
  ADMIN_SECRET: string
}

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  onPush: async (message, { storeId }) => {
    console.log(`onPush for store (${storeId})`, message.batch)
  },
}) {}

// Scoped by storeId
export class LiveStoreClientDO extends DurableObject implements SyncBackend.ClientDOInterface {
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
      storage: this.state.storage,
      // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
      syncBackendDurableObject: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
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
}

export default {
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/sync')) {
      // @ts-expect-error TODO remove casts once CF types are fixed in `@cloudflare/workers-types`
      return SyncBackend.handleSync(request, env, ctx, { headers: {} }) as Promise<Response>
    }

    // Forward request to client DO
    if (url.pathname.endsWith('/client-do')) {
      const storeId = storeIdFromRequest(request)
      const id = env.CLIENT_DO.idFromName(storeId)

      return env.CLIENT_DO.get(id).fetch(request)
    }

    if (url.pathname === '/') {
      return new Response('CloudFlare TodoMVC LiveStore Demo')
    }

    return new Response('Invalid path', { status: 400 })
  },
} satisfies ExportedHandler<Env>

/// Helper functions

const storeIdFromRequest = (request: Request) => {
  const url = new URL(request.url)
  const storeId = url.searchParams.get('storeId')

  if (storeId === null) {
    throw new Error('storeId is required in URL search params')
  }

  return storeId
}
