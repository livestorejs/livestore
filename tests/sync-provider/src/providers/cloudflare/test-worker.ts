/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'
import type { SyncBackend } from '@livestore/common'
import { layerRpcServerWebsocket } from '@livestore/common-cf'
import type { CfDeclare } from '@livestore/common-cf/declare'
import {
  type CfTypes,
  type ClientDOInterface,
  handleHttp,
  handleSync,
  makeDurableObject,
  type SyncBackendRpcInterface,
} from '@livestore/sync-cf/cf-worker'
import { makeDoRpcSync } from '@livestore/sync-cf/client'
import type { SyncMessage } from '@livestore/sync-cf/common'
import {
  Effect,
  FetchHttpClient,
  Fiber,
  Layer,
  Logger,
  LogLevel,
  Mailbox,
  RpcSerialization,
  RpcServer,
  Stream,
} from '@livestore/utils/effect'
import { DoRpcProxyRpcs } from './do-rpc-proxy-schema.ts'

declare class Request extends CfDeclare.Request {}
declare class Response extends CfDeclare.Response {}
declare class WebSocketPair extends CfDeclare.WebSocketPair {}

export interface Env {
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface>
  TEST_CLIENT_DO: CfTypes.DurableObjectNamespace
  /** Eventlog database */
  DB: CfTypes.D1Database
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
  state: CfTypes.DurableObjectState,
  env: Env,
) => CfTypes.DurableObject

export class TestClientDo extends DurableObjectBase implements ClientDOInterface {
  __DURABLE_OBJECT_BRAND = 'ClientDO' as never
  env: Env
  ctx: CfTypes.DurableObjectState

  private serverCtxMap: Map<
    CfTypes.WebSocket,
    {
      fiber: Fiber.Fiber<any>
      onMessage: (message: string | ArrayBuffer) => Promise<void>
    }
  > = new Map()

  constructor(state: CfTypes.DurableObjectState, env: Env) {
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
    // We'd use this for non-hibernated WebSocket connections
    // server.accept()
    // server.addEventListener('message', (event) => {
    //   console.log('message from client', event.data)
    //   incomingQueue.offer(event.data).pipe(Effect.tapCauseLogPretty, Effect.runFork)
    // })

    // Hibernate the server
    this.ctx.acceptWebSocket(server)

    await this.launchServer(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async webSocketMessage(ws: CfTypes.WebSocket, message: string | ArrayBuffer): Promise<void> {
    console.log('webSocketMessage', message, this.serverCtxMap.has(ws))
    const { onMessage } = await this.launchServer(ws)

    await onMessage(message)
  }

  webSocketClose(ws: CfDeclare.WebSocket, _code: number, _reason: string, _wasClean: boolean): void | Promise<void> {
    const ctx = this.serverCtxMap.get(ws)
    if (ctx) {
      ctx.fiber.pipe(Fiber.interrupt, Effect.runFork)
      this.serverCtxMap.delete(ws)
    }
  }

  private launchServer = (ws: CfTypes.WebSocket) =>
    Effect.gen(this, function* () {
      if (this.serverCtxMap.has(ws)) {
        return this.serverCtxMap.get(ws)!
      }

      yield* Effect.logDebug(`Launching WebSocket Effect RPC server`)

      const syncBackendMap = new Map<string, SyncBackend.SyncBackend<SyncMessage.SyncMetadata>>()

      const getSyncBackend = ({ clientId, storeId, payload }: { clientId: string; storeId: string; payload: any }) =>
        Effect.gen(this, function* () {
          const key = JSON.stringify({ clientId, storeId, payload })
          if (syncBackendMap.has(key)) {
            return syncBackendMap.get(key)!
          }

          const syncBackend = yield* makeDoRpcSync({
            clientId,
            syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
            durableObjectId: this.ctx.id.toString(),
          })({ storeId, clientId, payload })

          syncBackendMap.set(key, syncBackend)

          return syncBackend
        }).pipe(Effect.orDie)

      const incomingQueue = yield* Mailbox.make<Uint8Array<ArrayBufferLike> | string>()

      const fiber = yield* Effect.gen(function* () {
        const ProtocolLive = layerRpcServerWebsocket({
          send: (msg) => Effect.succeed(ws.send(msg)),
          incomingQueue,
        }).pipe(Layer.provide(RpcSerialization.layerJson))

        const handlersLayer = DoRpcProxyRpcs.toLayer({
          Connect: (args) =>
            Effect.gen(function* () {
              const syncBackend = yield* getSyncBackend(args)
              yield* syncBackend.connect
            }),
          Pull: (args) =>
            Effect.gen(function* () {
              const syncBackend = yield* getSyncBackend(args)
              return syncBackend.pull(args.args as any)
            }).pipe(Stream.unwrap),
          Push: ({ batch, ...args }) =>
            Effect.gen(function* () {
              const syncBackend = yield* getSyncBackend(args)
              yield* syncBackend.push(batch)
            }),
          Ping: () =>
            Effect.gen(function* () {
              const syncBackend = yield* getSyncBackend({ clientId: 'test', storeId: 'test', payload: {} })
              yield* syncBackend.ping
            }).pipe(Effect.orDie),
          IsConnected: () =>
            Effect.gen(function* () {
              const syncBackend = yield* getSyncBackend({ clientId: 'test', storeId: 'test', payload: {} })
              return syncBackend.isConnected.changes
            }).pipe(Stream.unwrap),
          GetMetadata: () =>
            Effect.gen(function* () {
              const syncBackend = yield* getSyncBackend({ clientId: 'test', storeId: 'test', payload: {} })
              return syncBackend.metadata
            }),
        }).pipe(Layer.provide(ProtocolLive))

        const ServerLive = RpcServer.layer(DoRpcProxyRpcs).pipe(
          Layer.provide(handlersLayer),
          Layer.provide(ProtocolLive),
        )

        return yield* Layer.launch(ServerLive)
      }).pipe(Effect.tapCauseLogPretty, Effect.scoped, Effect.provide(FetchHttpClient.layer), Effect.forkDaemon)

      const runtime = yield* Effect.runtime()

      const ctx = {
        fiber,
        onMessage: (message: string | ArrayBuffer) =>
          incomingQueue
            .offer(message as Uint8Array<ArrayBufferLike> | string)
            .pipe(Effect.asVoid, Effect.provide(runtime), Effect.runPromise),
      }

      this.serverCtxMap.set(ws, ctx)

      return ctx
    }).pipe(
      Effect.tapCauseLogPretty,
      // Logger.withMinimumLogLevel(LogLevel.Debug), // Useful for debugging
      Effect.provide(Logger.prettyWithThread('test-worker')),
      Effect.withSpan('effect-ws-rpc-server'),
      Effect.runPromise,
    )
}

export default {
  fetch: async (request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/sync')) {
      return handleSync(request, env, ctx)
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
