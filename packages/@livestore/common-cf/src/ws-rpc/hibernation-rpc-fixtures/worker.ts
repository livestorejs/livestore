/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'

import { Effect, Layer, RpcMessage, RpcServer, Stream } from '@livestore/utils/effect'

import type * as CfTypes from '../../cf-types.ts'
import { setupDurableObjectWebSocketRpc } from '../ws-rpc-server.ts'
import { HibRpcs } from './rpc-schema.ts'

export interface Env {
  REAL_RPC_DO: DurableObjectNamespace<RealRpcDO>
  SENTINEL_RPC_DO: DurableObjectNamespace<SentinelRpcDO>
}

const setupServer = (self: DurableObject<Env, unknown>, instanceId: string) => {
  const handlersLayer = HibRpcs.toLayer({
    Ping: () => Effect.succeed({}),
    InstanceId: () => Effect.succeed({ id: instanceId }),
    // Same park shape as sync-cf's live pull.
    Live: () => Stream.make(1, 2, 3).pipe(Stream.concat(Stream.never)),
  })
  const ServerLive = RpcServer.layer(HibRpcs).pipe(Layer.provide(handlersLayer))
  setupDurableObjectWebSocketRpc({
    doSelf: self as unknown as CfTypes.DurableObject,
    rpcLayer: ServerLive,
    webSocketMode: 'hibernate',
  })
}

const acceptWs = (ctx: DurableObjectState): Response => {
  const { 0: client, 1: server } = new WebSocketPair()
  ctx.acceptWebSocket(server)
  // Auto-respond to RPC pings, else each idle keepalive ping wakes the DO and resets its idle timer.
  ctx.setWebSocketAutoResponse(
    new WebSocketRequestResponsePair(JSON.stringify(RpcMessage.constPing), JSON.stringify(RpcMessage.constPong)),
  )
  return new Response(null, { status: 101, webSocket: client })
}

/** `instanceId` is never persisted, so it changes iff the DO was evicted and rebuilt. */
export class RealRpcDO extends DurableObject<Env, unknown> {
  instanceId = crypto.randomUUID()

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.ctx = state
    setupServer(this, this.instanceId)
  }

  override async fetch(): Promise<Response> {
    return acceptWs(this.ctx)
  }
}

/**
 * Identical, plus the timer `Effect.never` used to register on v3. Must stay resident — without this
 * counter-case a harness that hibernates nothing would pass the assertions above just as happily.
 */
export class SentinelRpcDO extends DurableObject<Env, unknown> {
  instanceId = crypto.randomUUID()

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.ctx = state
    setInterval(() => {}, 2 ** 31 - 1)
    setupServer(this, this.instanceId)
  }

  override async fetch(): Promise<Response> {
    return acceptWs(this.ctx)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Guard before routing, so the harness's readiness `GET /` can't construct a stray DO.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Durable Object expected Upgrade: websocket', { status: 426 })
    }
    const url = new URL(request.url)
    const ns = url.pathname.startsWith('/sentinel') === true ? env.SENTINEL_RPC_DO : env.REAL_RPC_DO
    // Keyed by path so one case's traffic can't wake another's DO.
    return ns.get(ns.idFromName(url.pathname)).fetch(request)
  },
}
