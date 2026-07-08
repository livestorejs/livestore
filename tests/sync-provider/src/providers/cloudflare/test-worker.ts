/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'

import type { SyncBackend } from '@livestore/common'
import {
  type ClientDoWithRpcCallback,
  setupDurableObjectWebSocketRpc,
  type SyncUpdateRpcResult,
} from '@livestore/common-cf'
import type { CfDeclare } from '@livestore/common-cf/declare'
import {
  type CfTypes,
  handleSyncRequest,
  makeDurableObject,
  matchSyncRequest,
  type SyncBackendRpcInterface,
} from '@livestore/sync-cf/cf-worker'
import { handleSyncUpdateRpc, makeDoRpcSync } from '@livestore/sync-cf/client'
import type { SyncMessage } from '@livestore/sync-cf/common'
import {
  Effect,
  FetchHttpClient,
  KeyValueStore,
  Layer,
  type RpcMessage,
  RpcServer,
  Stream,
} from '@livestore/utils/effect'

import { DoRpcProxyRpcs } from './do-rpc-proxy-schema.ts'

declare class Request extends CfDeclare.Request {}
declare class Response extends CfDeclare.Response {}
declare class WebSocketPair extends CfDeclare.WebSocketPair {}

interface InstanceIdProbe {
  getInstanceId(): string
}

interface SyncDoProbe extends InstanceIdProbe {
  getRpcSubscriptionCount(): number
}

interface ClientDoProbe extends InstanceIdProbe {
  closeStore(): void
  openStore(): void
}

export interface Env {
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<SyncBackendRpcInterface & SyncDoProbe>
  TEST_CLIENT_DO: CfTypes.DurableObjectNamespace<ClientDoWithRpcCallback & ClientDoProbe>
  /** Eventlog database */
  DB: CfTypes.D1Database
}

export class SyncBackendDO extends makeDurableObject({
  // onPush: async (message) => {
  //   console.log('onPush', message.batch)
  // },
  // onPull: async (message) => {
  //   console.log('onPull', message)
  // },
  http: {
    responseHeaders: {
      'X-Custom-Header': 'test-value',
      'X-LiveStore-Version': '1.0.0',
    },
  },
}) {
  instanceId = crypto.randomUUID()

  getInstanceId(): string {
    return this.instanceId
  }

  getRpcSubscriptionCount(): number {
    // `makeDurableObject`'s public type erases `ctx`; the runtime base provides it (test-only narrowing).
    const { sql } = (this as unknown as { ctx: CfTypes.DurableObjectState }).ctx.storage
    const tables = sql
      .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rpc_subscription_%'`)
      .toArray() as unknown as ReadonlyArray<{ name: string }>
    let count = 0
    for (const { name } of tables) {
      const row = sql.exec(`SELECT COUNT(*) AS c FROM "${name}"`).toArray()[0] as unknown as { c: number } | undefined
      count += Number(row?.c ?? 0)
    }
    return count
  }
}

const DurableObjectBase = DurableObject as any as new (
  state: CfTypes.DurableObjectState,
  env: Env,
) => CfTypes.DurableObject

export class TestClientDo extends DurableObjectBase implements ClientDoWithRpcCallback {
  __DURABLE_OBJECT_BRAND = 'ClientDO' as never
  env: Env
  ctx: CfTypes.DurableObjectState
  instanceId = crypto.randomUUID()
  /** Store-liveness flag — analog of the real adapter's `cachedStore === undefined`. */
  storeClosed = false

  getInstanceId(): string {
    return this.instanceId
  }

  closeStore(): void {
    this.storeClosed = true
  }

  openStore(): void {
    this.storeClosed = false
  }

  constructor(state: CfTypes.DurableObjectState, env: Env) {
    super(state, env)
    this.ctx = state
    this.env = env

    const syncBackendMap = new Map<string, SyncBackend.SyncBackend<SyncMessage.SyncMetadata>>()

    const getSyncBackend = ({ clientId, storeId, payload }: { clientId: string; storeId: string; payload: any }) =>
      Effect.gen(this, function* () {
        const key = JSON.stringify({ clientId, storeId, payload })
        if (syncBackendMap.has(key) === true) {
          return syncBackendMap.get(key)!
        }

        const syncBackend = yield* makeDoRpcSync({
          syncBackendStub: this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(storeId)),
          durableObjectContext: { bindingName: 'TEST_CLIENT_DO', durableObjectId: this.ctx.id.toString() },
        })({ storeId, clientId, payload })

        syncBackendMap.set(key, syncBackend)

        return syncBackend
      }).pipe(Effect.orDie)

    /** Proxies WS messages to the DO RPC sync backend */
    const handlersLayer = DoRpcProxyRpcs.toLayer({
      Connect: (args) =>
        Effect.gen(function* () {
          const syncBackend = yield* getSyncBackend(args)
          yield* syncBackend.connect
        }),
      Pull: (args) =>
        Effect.gen(function* () {
          const syncBackend = yield* getSyncBackend(args)
          return syncBackend.pull(args.cursor as any, { live: args.live })
        }).pipe(
          Stream.unwrap,
          Stream.map((msg) => ({ ...msg, backendId: 'TODO' })),
        ),
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
      Layer.provide(KeyValueStore.layerMemory),
    )

    setupDurableObjectWebSocketRpc({
      doSelf: this,
      rpcLayer: ServerLive,
      webSocketMode: 'hibernate',
    })
  }

  override async fetch(request: CfTypes.Request): Promise<CfTypes.Response> {
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

  async syncUpdateRpc(payload: RpcMessage.ResponseChunkEncoded): Promise<SyncUpdateRpcResult> {
    // Store-liveness gate: reap once the store is gone (`storeClosed` is this harness's `cachedStore` analog).
    if (this.storeClosed === true) return true
    return handleSyncUpdateRpc(payload)
  }
}

export default {
  fetch: async (request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) => {
    const url = new URL(request.url)
    const searchParams = matchSyncRequest(request)
    if (searchParams !== undefined) {
      return handleSyncRequest({
        request,
        searchParams,
        env,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
      })
    }

    if (url.pathname.endsWith('/do-rpc-ws-proxy') === true) {
      const doName = 'test-client-do' // TODO make configurable/dynamic

      const id = env.TEST_CLIENT_DO.idFromName(doName)
      const durableObject = env.TEST_CLIENT_DO.get(id)

      return durableObject.fetch(request)
    }

    // Probes for `do-rpc-hibernation.test.ts`: per-instance id (eviction), subscription count (reap),
    // store-liveness toggle (drives the reap gate). Reading the client id also keeps it warm.
    if (url.pathname.endsWith('/instance/sync') === true) {
      const storeId = url.searchParams.get('storeId') ?? 'default'
      const instanceId = await env.SYNC_BACKEND_DO.get(env.SYNC_BACKEND_DO.idFromName(storeId)).getInstanceId()
      return new Response(JSON.stringify({ instanceId }), { headers: { 'content-type': 'application/json' } })
    }

    if (url.pathname.endsWith('/instance/client') === true) {
      const instanceId = await env.TEST_CLIENT_DO.get(env.TEST_CLIENT_DO.idFromName('test-client-do')).getInstanceId()
      return new Response(JSON.stringify({ instanceId }), { headers: { 'content-type': 'application/json' } })
    }

    if (url.pathname.endsWith('/rpc-subscriptions/count') === true) {
      const storeId = url.searchParams.get('storeId') ?? 'default'
      const count = await env.SYNC_BACKEND_DO.get(env.SYNC_BACKEND_DO.idFromName(storeId)).getRpcSubscriptionCount()
      return new Response(JSON.stringify({ count }), { headers: { 'content-type': 'application/json' } })
    }

    if (url.pathname.endsWith('/do-rpc/close') === true) {
      await env.TEST_CLIENT_DO.get(env.TEST_CLIENT_DO.idFromName('test-client-do')).closeStore()
      return new Response(JSON.stringify({ closed: true }), { headers: { 'content-type': 'application/json' } })
    }

    if (url.pathname.endsWith('/do-rpc/open') === true) {
      await env.TEST_CLIENT_DO.get(env.TEST_CLIENT_DO.idFromName('test-client-do')).openStore()
      return new Response(JSON.stringify({ closed: false }), { headers: { 'content-type': 'application/json' } })
    }

    return new Response('Invalid path', { status: 400 })
  },
}
