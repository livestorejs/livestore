import type * as CfWorker from '@cloudflare/workers-types'
import { type CreateStoreDoOptions, createStoreDoPromise } from '@livestore/adapter-cloudflare'
import { exposeDebugUtils, nanoid, type Store } from '@livestore/livestore'
import * as CfSyncBackend from '@livestore/sync-cf/cf-worker'
import { shouldNeverHappen } from '@livestore/utils'
import { events, schema, tables } from './schema.ts'

exposeDebugUtils()

declare class Response extends CfWorker.Response {}

type Env = {
  CLIENT_DO: CfWorker.DurableObjectNamespace
  SYNC_BACKEND_DO: CfWorker.DurableObjectNamespace
  DB: CfWorker.D1Database
  ADMIN_SECRET: string
}

export class ClientDO implements CfWorker.DurableObject {
  env: Env
  ctx: CfWorker.DurableObjectState
  private store: Store<typeof schema> | undefined

  constructor(state: CfWorker.DurableObjectState, env: Env) {
    this.ctx = state
    this.env = env
  }

  async fetch(request: CfWorker.Request): Promise<CfWorker.Response> {
    const options = await this.getOptions(request)
    const store = await this.ensureStore(options)

    const url = new URL(request.url)

    if (url.pathname.startsWith('/do/list')) {
      const list = store.query(tables.todos)
      return new Response(JSON.stringify(list), {
        headers: { 'Content-Type': 'application/json' },
      })
    } else if (url.pathname.startsWith('/do/create')) {
      store.commit(
        events.todoCreated({
          id: `todo-${Date.now()}`,
          text: 'Hello, world!',
        }),
      )

      const totalTodos = store.query(tables.todos.count())

      return new Response(JSON.stringify({ success: true, totalTodos }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  private ensureStore = async (options_?: Pick<CreateStoreDoOptions, 'storeId' | 'clientId' | 'sessionId'>) => {
    if (this.store === undefined) {
      console.log('Store not initialized, initializing...')
      const options = options_ ?? (await this.getOptions())
      const syncBackendDurableObject = this.env.SYNC_BACKEND_DO.get(
        this.env.SYNC_BACKEND_DO.idFromName(options.storeId),
      )

      this.store = await createStoreDoPromise({
        ...options,
        schema,
        syncBackendDurableObject,
        storage: this.ctx.storage,
      })


      this.store.subscribe(tables.todos.where('completed', false), {onUpdate: (list) => {
        console.log('onUpdate', list)
      }})
    }

    return this.store
  }

  private getOptions = async (
    request?: CfWorker.Request,
  ): Promise<Pick<CreateStoreDoOptions, 'storeId' | 'clientId' | 'sessionId'>> => {
    if (request === undefined) {
      return JSON.parse((await this.ctx.storage.get('options')) as string)
    }

    const url = new URL(request.url)
    const options = {
      storeId: url.searchParams.get('storeId') ?? shouldNeverHappen(`No storeId provided`),
      clientId: url.searchParams.get('clientId') ?? '007',
      sessionId: url.searchParams.get('sessionId') ?? nanoid(),
    }

    this.ctx.storage.put('options', JSON.stringify(options))

    return options
  }
}

// Real sync backend DO using @livestore/sync-cf
export class SyncBackendDO extends CfSyncBackend.makeDurableObject({
  onPush: async (message, context) => {
    console.log(`Sync backend received push: ${message.batch.length} events for storeId: ${context.storeId}`)
  },
  onPull: async (_message, context) => {
    console.log(`Sync backend received pull request for storeId: ${context.storeId}`)
  },
}) {}

// Worker entry point
const worker = {
  fetch: async (request: CfWorker.Request, env: Env, ctx: CfWorker.ExecutionContext): Promise<CfWorker.Response> => {
    const url = new URL(request.url)

    console.log('request', url.pathname)

    // Route WebSocket connections to sync backend DO
    if (url.pathname === '/websocket') {
      return CfSyncBackend.handleWebSocket(request, env, ctx, {
        durableObject: { name: 'SYNC_BACKEND_DO' },
      })
    }

    // Route to client DO
    if (url.pathname.startsWith('/do/')) {
      const storeId = url.searchParams.get('storeId') ?? shouldNeverHappen(`No storeId provided`)
      const client = env.CLIENT_DO.get(env.CLIENT_DO.idFromName(storeId))
      return client.fetch(request)
    }

    return new Response('Not found', { status: 404 })
  },
} satisfies CfWorker.ExportedHandler<Env>

export default worker
