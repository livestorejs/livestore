import type * as CfWorker from '@cloudflare/workers-types'
import { makeDurableObject } from '@livestore/adapter-cloudflare'
import { nanoid } from '@livestore/livestore'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import { events, schema, tables } from './livestore/schema.ts'

type Env = {
  CLIENT_DO: CfWorker.DurableObjectNamespace<LiveStoreClientDO>
  WEBSOCKET_SERVER: CfWorker.DurableObjectNamespace
  DB: CfWorker.D1Database
  ADMIN_SECRET: string
}

export class WebSocketServer extends SyncBackend.makeDurableObject({}) {}

declare class Response extends CfWorker.Response {}

// export class WebSocketHibernationServer extends CfWorker.DurableObject {
//   async fetch(request: Request) {
//     // Creates two ends of a WebSocket connection.
//     const { 0: client, 1: server } = new WebSocketPair()
//     // TODO: get storeId and payload from request
//     const storeId = '123'
//     const payload = {}

//     server.serializeAttachment({ storeId, payload })

//     // Calling `acceptWebSocket()` informs the runtime that this WebSocket is to begin terminating
//     // request within the Durable Object. It has the effect of "accepting" the connection,
//     // and allowing the WebSocket to send and receive messages.
//     // Unlike `ws.accept()`, `state.acceptWebSocket(ws)` informs the Workers Runtime that the WebSocket
//     // is "hibernatable", so the runtime does not need to pin this Durable Object to memory while
//     // the connection is open. During periods of inactivity, the Durable Object can be evicted
//     // from memory, but the WebSocket connection will remain open. If at some later point the
//     // WebSocket receives a message, the runtime will recreate the Durable Object
//     // (run the `constructor`) and deliver the message to the appropriate handler.
//     this.ctx.acceptWebSocket(server)

//     return new Response(null, {
//       status: 101,
//       webSocket: client,
//     })
//   }

//   async webSocketMessage(ws: WebSocket, message: string) {
//     const { storeId, payload } = ws.deserializeAttachment()

//     const adapter = makeAdapter({})
//     const store = await createStorePromise({ adapter, schema, storeId })

//     // Upon receiving a message from the client, reply with the same message,
//     // but will prefix the message with "[Durable Object]: " and return the
//     // total number of connections.
//     ws.send(`[Durable Object] message: ${message}, connections: ${this.ctx.getWebSockets().length}`)
//   }

//   async onLiveStoreEvent(event: LiveStoreEvent.ForSchema<typeof schema>) {
//     if (event.name === 'v1.TodoCreated') {
//       const { id, text } = event.args
//       await this.ctx.storage.put({ id, text, completed: false })
//     }
//   }

//   async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
//     // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
//     ws.close(code, 'Durable Object is closing WebSocket')
//   }
// }

const storeId = '124'

export class LiveStoreClientDO extends makeDurableObject({
  schema,
  clientId: '123',
  sessionId: '123',
  // makeStore: (adapter) => createStorePromise({ adapter, schema, storeId: '123' }),
  onStoreReady: (store) => {
    const todos = store.query(tables.todos)
    console.log('todos', todos)
    store.commit(events.todoCreated({ id: nanoid(), text: 'test' }))
    console.log('todos after commit', store.query(tables.todos))
  },
  registerQueries: (store) => [
    store.subscribe(tables.todos.where({ completed: false }), {
      onUpdate: (todos) => {
        console.log('todos', todos)
      },
    }),
  ],
  storeId,
}) {}

// export class LiveStoreClientDO extends makeDurableObject({
//   ready: async (ctx) => {
//     const adapter = makeAdapter({})
//     const store = createStorePromise({
//       adapter,
//       schema,
//       storeId: '123'
//     })
//   }
// }) {}

const worker = {
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/websocket')) {
      return SyncBackend.handleWebSocket(request, env, ctx, { headers: {} })
    }

    if (url.pathname.endsWith('/poke-do-client')) {
      const id = env.CLIENT_DO.idFromName(storeId)
      ctx.waitUntil(env.CLIENT_DO.get(id).fetch('https://poke')) // wakes / recreates if needed
      return new Response(`Poked DO client ${storeId}`)
    }

    if (url.pathname === '/') {
      return new Response('CloudFlare TodoMVC LiveStore Demo')
    }

    return new Response('Invalid path', { status: 400 })
  },
  async scheduled(_controller: CfWorker.ScheduledController, env: Env, ctx: CfWorker.ExecutionContext) {
    const id = env.CLIENT_DO.idFromName('singleton')
    ctx.waitUntil(env.CLIENT_DO.get(id).fetch('https://poke')) // wakes / recreates if needed
  },
} satisfies CfWorker.ExportedHandler<Env>

export default worker
