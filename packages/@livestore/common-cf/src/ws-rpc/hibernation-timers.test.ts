/**
 * @fileoverview Reproduces the Durable Object hibernation disqualifier in isolation.
 *
 * Cloudflare DO WebSocket Hibernation is suppressed while the isolate has *any* pending
 * `setTimeout`/`setInterval` (per CF docs: "No setTimeout/setInterval scheduled callbacks
 * are set, since there would be no way to recreate the callback after hibernating").
 *
 * `effect`'s `Effect.never` is implemented as `asyncInterrupt(() => { setInterval(()=>{}, 2**31-1) })`
 * — a Node-only event-loop keepalive. Every connection-holding park that bottoms out in
 * `Effect.never` therefore registers a pending long-period `setInterval`, which keeps the DO
 * resident (billed for full wall-clock) instead of hibernating between messages.
 *
 * These tests count pending long-period `setInterval` timers — the exact, runtime-independent
 * disqualifier — without needing wrangler/miniflare. A non-zero count on an idle connection ==
 * "cannot hibernate".
 */
import { afterEach, beforeEach, expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Context,
  Effect,
  Fiber,
  Layer,
  Rpc,
  RpcGroup,
  RpcSerialization,
  RpcServer,
  Schema,
  Stream,
} from '@livestore/utils/effect'

import type * as CfTypes from '../cf-types.ts'
import { setupDurableObjectWebSocketRpc } from './ws-rpc-server.ts'

// The `Effect.never` timer uses `2 ** 31 - 1` ms. Count only long-period timers so we don't
// catch unrelated short Effect/runtime timers (schedules, ping intervals, etc.).
const NEVER_PERIOD_MS = 2 ** 31 - 1
const LONG_MS = 1_000_000

let realSetInterval: typeof globalThis.setInterval
let realClearInterval: typeof globalThis.clearInterval
const liveLongTimers = new Map<ReturnType<typeof setInterval>, number>()

const longTimerCount = () => liveLongTimers.size
const longTimerPeriods = () => [...liveLongTimers.values()]

/** Wait `ms` using the REAL (un-instrumented) timer so forked fibers can park. */
const realDelay = (ms: number) => new Promise<void>((resolve) => realSetInterval(() => resolve(), ms))

beforeEach(() => {
  realSetInterval = globalThis.setInterval
  realClearInterval = globalThis.clearInterval
  liveLongTimers.clear()
  globalThis.setInterval = ((cb: any, ms?: number, ...args: any[]) => {
    const id = realSetInterval(cb, ms as any, ...args)
    if ((ms ?? 0) > LONG_MS) liveLongTimers.set(id, ms!)
    return id
  }) as typeof globalThis.setInterval
  globalThis.clearInterval = ((id?: any) => {
    if (id !== undefined) liveLongTimers.delete(id)
    realClearInterval(id)
  }) as typeof globalThis.clearInterval
})

afterEach(() => {
  globalThis.setInterval = realSetInterval
  globalThis.clearInterval = realClearInterval
})

Vitest.describe('hibernation disqualifier — root mechanic (effect only)', () => {
  Vitest.test('Effect.never registers exactly one setInterval(2**31-1)', async () => {
    const fiber = Effect.runFork(Effect.never)
    await realDelay(50)
    expect(longTimerCount()).toBe(1)
    expect(longTimerPeriods()).toEqual([NEVER_PERIOD_MS])

    await Effect.runPromise(Fiber.interrupt(fiber))
    await realDelay(20)
    expect(longTimerCount()).toBe(0)
  })

  Vitest.test('Stream.never registers one long-period timer (via Effect.never)', async () => {
    const fiber = Effect.runFork(Stream.runDrain(Stream.never))
    await realDelay(50)
    expect(longTimerCount()).toBe(1)
    expect(longTimerPeriods()).toEqual([NEVER_PERIOD_MS])

    await Effect.runPromise(Fiber.interrupt(fiber))
    await realDelay(20)
    expect(longTimerCount()).toBe(0)
  })

  Vitest.test('Layer.launch registers one long-period timer (via Effect.never)', async () => {
    class SomeTag extends Context.Tag('SomeTag')<SomeTag, { readonly x: number }>() {}
    const fiber = Effect.runFork(Layer.launch(Layer.succeed(SomeTag, { x: 1 })))
    await realDelay(50)
    expect(longTimerCount()).toBe(1)
    expect(longTimerPeriods()).toEqual([NEVER_PERIOD_MS])

    await Effect.runPromise(Fiber.interrupt(fiber))
    await realDelay(20)
    expect(longTimerCount()).toBe(0)
  })

  // The fix direction: a timer-less "park forever" that still never resolves and stays interruptible.
  // This is what the parks above should be replaced with to make the DO hibernatable.
  Vitest.test('Effect.async<never> (proposed timer-less park) registers no long-period timer', async () => {
    const fiber = Effect.runFork(Effect.async<never>(() => {}))
    await realDelay(50)
    expect(longTimerCount()).toBe(0)

    await Effect.runPromise(Fiber.interrupt(fiber))
    await realDelay(20)
    expect(longTimerCount()).toBe(0)
  })
})

// Minimal RPC surface to launch the real WS-RPC server. `Live` returns `Stream.concat(Stream.never)`,
// mirroring `@livestore/sync-cf`'s live-pull handler.
class HibRpcs extends RpcGroup.make(
  Rpc.make('Ping', { payload: Schema.Struct({}), success: Schema.Struct({}) }),
  Rpc.make('Live', { payload: Schema.Struct({}), success: Schema.Number, stream: true }),
) {}

const handlersLayer = HibRpcs.toLayer({
  Ping: () => Effect.succeed({}),
  // Mirrors sync-cf live pull: emit a backlog then hold the stream open forever via Stream.never.
  Live: () => Stream.make(1, 2, 3).pipe(Stream.concat(Stream.never)),
})

const makeServer = () => {
  const ServerLive = RpcServer.layer(HibRpcs).pipe(Layer.provide(handlersLayer))
  const sent: Array<string | Uint8Array> = []
  // Minimal fake WebSocket — `setupDurableObjectWebSocketRpc` only needs `send` for this RPC surface.
  const ws = { send: (data: string | Uint8Array) => sent.push(data) } as unknown as CfTypes.WebSocket
  // Minimal fake DO — only used as an assignment target for the webSocket* handlers.
  const doSelf = {} as unknown as CfTypes.DurableObject
  const handlers = setupDurableObjectWebSocketRpc({ doSelf, rpcLayer: ServerLive, webSocketMode: 'hibernate' })
  return { ws, sent, ...handlers }
}

Vitest.describe('hibernation fix — real setupDurableObjectWebSocketRpc path is timer-less', () => {
  Vitest.test('launching the WS-RPC server holds 0 long-period timers', async () => {
    const { ws, webSocketMessage, webSocketClose } = makeServer()
    expect(longTimerCount()).toBe(0)

    // First inbound message launches the server (empty JSON batch is a decode no-op).
    await webSocketMessage(ws, '[]')
    await realDelay(150)

    expect(longTimerCount()).toBe(0)
    expect(longTimerPeriods()).toEqual([])

    await webSocketClose(ws, 1000, 'test', true)
    await realDelay(50)
    expect(longTimerCount()).toBe(0)
  })
})
