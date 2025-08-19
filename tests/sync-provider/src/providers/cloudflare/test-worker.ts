/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'
import type { SyncBackend } from '@livestore/common'
import { setupDurableObjectWebSocketRpc } from '@livestore/common-cf'
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
import { Effect, FetchHttpClient, Layer, RpcServer, Stream } from '@livestore/utils/effect'
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
  // onPush: async (message) => {
  //   console.log('onPush', message.batch)
  // },
  // onPull: async (message) => {
  //   console.log('onPull', message)
  // },
}) {}

const DurableObjectBase = DurableObject as any as new (
  state: CfTypes.DurableObjectState,
  env: Env,
) => CfTypes.DurableObject

export class TestClientDo extends DurableObjectBase implements ClientDOInterface {
  __DURABLE_OBJECT_BRAND = 'ClientDO' as never
  env: Env
  ctx: CfTypes.DurableObjectState

  constructor(state: CfTypes.DurableObjectState, env: Env) {
    super(state, env)
    this.ctx = state
    this.env = env

    const syncBackendMap = new Map<string, SyncBackend.SyncBackend<SyncMessage.SyncMetadata>>()

    const getSyncBackend = ({ clientId, storeId, payload }: { clientId: string; storeId: string; payload: any }) =>
      Effect.gen(this, function* () {
        const key = JSON.stringify({ clientId, storeId, payload })
        if (syncBackendMap.has(key)) {
          console.log('using cached sync backend', syncBackendMap.get(key))
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
      Ping: (args) =>
        Effect.gen(function* () {
          const syncBackend = yield* getSyncBackend(args)
          yield* syncBackend.ping
        }).pipe(Effect.orDie),
      IsConnected: (args) =>
        Effect.gen(function* () {
          const syncBackend = yield* getSyncBackend(args)
          return syncBackend.isConnected.changes
        }).pipe(Stream.unwrap),
      GetMetadata: (args) =>
        Effect.gen(function* () {
          const syncBackend = yield* getSyncBackend(args)
          return syncBackend.metadata
        }),
    })

    const ServerLive = RpcServer.layer(DoRpcProxyRpcs).pipe(
      Layer.provide(handlersLayer),
      Layer.provide(FetchHttpClient.layer),
    )

    setupDurableObjectWebSocketRpc({
      doSelf: this,
      rpcLayer: ServerLive,
      webSocketMode: 'hibernate',
    })
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

    // await this.launchServer(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }
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
      const doName = 'test-client-do' // TODO make configurable/dynamic

      const id = env.TEST_CLIENT_DO.idFromName(doName)
      const durableObject = env.TEST_CLIENT_DO.get(id)

      return durableObject.fetch(request)
    }

    return new Response('Invalid path', { status: 400 })
  },
}
