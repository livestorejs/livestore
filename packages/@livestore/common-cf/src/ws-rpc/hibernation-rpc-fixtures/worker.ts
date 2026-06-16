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

/** Wires the REAL (now timer-less) `setupDurableObjectWebSocketRpc` server onto `self`. */
const setupServer = (self: DurableObject, instanceId: string) => {
  const handlersLayer = HibRpcs.toLayer({
    Ping: () => Effect.succeed({}),
    InstanceId: () => Effect.succeed({ id: instanceId }),
    Live: () => Stream.make(1, 2, 3).pipe(Stream.concat(Stream.fromEffect(Effect.async<never>(() => {})))),
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
  // Model real sync-cf: auto-respond to Effect-RPC pings so idle keepalive pings don't wake the DO.
  // (Without this, client pings arrive as webSocketMessage and reset the hibernation idle timer.)
  ctx.setWebSocketAutoResponse(
    new WebSocketRequestResponsePair(JSON.stringify(RpcMessage.constPing), JSON.stringify(RpcMessage.constPong)),
  )
  return new Response(null, { status: 101, webSocket: client })
}

/** The real, fixed WS-RPC server: its connection-holding parks are timer-less, so it hibernates at idle. */
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
 * Regression sentinel: the same real server, but re-introduces one long-period `setInterval` — exactly the
 * disqualifier `Effect.never` used to register. It must NOT hibernate. This proves the test still detects a
 * timer regression (so a future reintroduction can't pass silently) and documents the pre-fix behavior.
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
    const url = new URL(request.url)
    const ns = url.pathname.startsWith('/sentinel') ? env.SENTINEL_RPC_DO : env.REAL_RPC_DO
    return ns.get(ns.idFromName('rpc')).fetch(request)
  },
}
