/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'
import { layerRpcServerWebsocket } from '@livestore/common-cf'
import { makeDoRpcSync } from '@livestore/sync-cf'
import {
  type CfWorker,
  type ClientDOInterface,
  handleHttp,
  handleWebSocket,
  makeDurableObject,
  type SyncBackendRpcInterface,
} from '@livestore/sync-cf/cf-worker'
import { Effect, FetchHttpClient, Layer, Mailbox, RpcSerialization, RpcServer } from '@livestore/utils/effect'
import { SyncProxyRpcs } from './test-rpc-schema.ts'

declare class Request extends CfWorker.Request {}
declare class Response extends CfWorker.Response {}
declare class WebSocketPair extends CfWorker.WebSocketPair {}

export interface Env {
  SYNC_BACKEND_DO: CfWorker.DurableObjectNamespace<SyncBackendRpcInterface>
  TEST_CLIENT_DO: CfWorker.DurableObjectNamespace
  /** Eventlog database */
  DB: CfWorker.D1Database
  ADMIN_SECRET: string
}

export class SyncBackendDO extends makeDurableObject({
  onPush: async (message) => {
    console.log('onPush', message.batch)
  },
  onPull: async (message) => {
    console.log('onPull', message)
  },
}) {}

const DurableObjectBase = DurableObject as any as new (
  state: CfWorker.DurableObjectState,
  env: Env,
) => CfWorker.DurableObject

export class TestClientDo extends DurableObjectBase implements ClientDOInterface {
  __DURABLE_OBJECT_BRAND = 'ClientDO' as never
  env: Env
  ctx: CfWorker.DurableObjectState
  // store: Store<typeof schema> | undefined
  incomingQueue: Mailbox.Mailbox<Uint8Array<ArrayBufferLike> | string> | undefined

  constructor(state: CfWorker.DurableObjectState, env: Env) {
    super(state, env)
    this.ctx = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader === undefined || upgradeHeader !== 'websocket') {
      return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
    }

    const { 0: client, 1: server } = new WebSocketPair()

    // Accept the connection
    // server.accept()

    // Hibernate the server
    this.ctx.acceptWebSocket(server)

    Effect.gen(this, function* () {
      const storeId = 'test-store'
      const clientId = 'test-client'
      const payload = undefined

      const syncBackend = yield* makeDoRpcSync({
        clientId,
        syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
        durableObjectId: this.ctx.id.toString(),
      })({ storeId, clientId, payload })

      const incomingQueue = yield* Mailbox.make<Uint8Array<ArrayBufferLike> | string>()

      // server.addEventListener('message', (event) => {
      //   console.log('message from client', event.data)
      //   incomingQueue.offer(event.data).pipe(Effect.tapCauseLogPretty, Effect.runFork)
      // })

      this.incomingQueue = incomingQueue

      const ProtocolLive = layerRpcServerWebsocket({
        send: (msg) => Effect.succeed(server.send(msg)),
        incomingQueue,
      }).pipe(Layer.provide(RpcSerialization.layerJson))

      const handlersLayer = SyncProxyRpcs.toLayer({
        Connect: () => syncBackend.connect.pipe(Effect.tapCauseLogPretty),
        Pull: (args) => syncBackend.pull(args as any),
        Push: (batch) => syncBackend.push(batch.batch).pipe(Effect.tapCauseLogPretty),
        Ping: () =>
          syncBackend.ping.pipe(
            Effect.catchTag('TimeoutException', (e) => Effect.die(e)),
            Effect.tapCauseLogPretty,
          ),
        IsConnected: () => syncBackend.isConnected.changes,
        GetMetadata: () => Effect.succeed(syncBackend.metadata),
      }).pipe(Layer.provide(ProtocolLive))

      const ServerLive = RpcServer.layer(SyncProxyRpcs).pipe(Layer.provide(handlersLayer), Layer.provide(ProtocolLive))

      // yield* Stream.fromEventListener(server, 'message', (event) => incomingQueue.offer(event.data)).pipe(
      //   Stream.runDrain,
      //   Effect.tapCauseLogPretty,
      //   Effect.forkScoped,
      // )

      // let i = 0
      // setInterval(() => {
      //   console.log('i', i++)
      // }, 100)

      yield* Effect.addFinalizerLog('ServerLive finalized')

      yield* Layer.launch(ServerLive).pipe(Effect.tapCauseLogPretty)
    }).pipe(Effect.tapCauseLogPretty, Effect.scoped, Effect.provide(FetchHttpClient.layer), Effect.runPromise)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async webSocketMessage(_ws: CfWorker.WebSocket, message: string | ArrayBuffer): Promise<void> {
    // console.log('webSocketMessage', message, this.incomingQueue !== undefined)
    if (!this.incomingQueue) {
      return
    }

    this.incomingQueue
      .offer(message as Uint8Array<ArrayBufferLike> | string)
      .pipe(Effect.tapCauseLogPretty, Effect.runPromise)
  }
}

export default {
  fetch: async (request: CfWorker.Request, env: Env, ctx: CfWorker.ExecutionContext) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/websocket')) {
      return handleWebSocket(request, env, ctx)
    }

    if (url.pathname.endsWith('/http-rpc')) {
      return handleHttp(request, env, ctx)
    }

    if (url.pathname.endsWith('/do-rpc-ws-proxy')) {
      const upgradeHeader = request.headers.get('Upgrade')
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
      }

      const doName = 'test-client-do' // TODO make configurable/dynamic

      const id = env.TEST_CLIENT_DO.idFromName(doName)
      const durableObject = env.TEST_CLIENT_DO.get(id)

      return durableObject.fetch(request)
    }

    return new Response('Invalid path', { status: 400 })
  },
}
