/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from 'cloudflare:workers'

export interface Env {
  CONTROL_DO: DurableObjectNamespace<ControlDO>
  TIMER_DO: DurableObjectNamespace<TimerDO>
}

/**
 * Empirical probe for whether local `wrangler dev`/miniflare actually evicts hibernatable DOs.
 *
 * Each DO exposes a per-INSTANCE uuid (`instanceId`, set in the constructor, NOT persisted). If the
 * DO hibernates (is evicted from memory), the next inbound message reconstructs it and the constructor
 * re-runs → a NEW uuid. So `instanceId` changing across an idle gap == hibernation actually happened.
 *
 * - `ControlDO`: a faithful hibernatable WS server with zero pending timers → SHOULD hibernate.
 * - `TimerDO`:   identical, but holds one pending `setInterval(2**31-1)` (the exact thing `Effect.never`
 *                registers) → should NOT hibernate IF the runtime enforces the pending-timer gate.
 *
 * The raw-WS test client sends nothing during the idle window, so there is no application-ping confound.
 */
export class ControlDO extends DurableObject<Env, unknown> {
  instanceId = crypto.randomUUID()

  override async fetch(_request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'id') ws.send(this.instanceId)
  }
}

export class TimerDO extends DurableObject<Env, unknown> {
  instanceId = crypto.randomUUID()

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    // Mimic the `Effect.never` keepalive: a single pending long-period timer in the isolate.
    setInterval(() => {}, 2 ** 31 - 1)
  }

  override async fetch(_request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'id') ws.send(this.instanceId)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const ns = url.pathname.startsWith('/timer') ? env.TIMER_DO : env.CONTROL_DO
    return ns.get(ns.idFromName('probe')).fetch(request)
  },
}
