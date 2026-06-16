/**
 * @fileoverview Capstone — observes the ACTUAL hibernation OUTCOME of the real (now timer-less) WS-RPC
 * server, in a faithful local workerd runtime that (per `hibernation-probe.test.ts`) hibernates and
 * enforces the pending-timer gate exactly like production.
 *
 * Unlike the timer-count proxy, this measures the real-world result and therefore accounts for ALL
 * hibernation gating conditions at once (timers, pending I/O, in-flight requests, hibernatable API):
 *
 *   - `RealRpcDO`     — the real, fixed server → DOES hibernate at idle and still serves RPC after wake.
 *   - `SentinelRpcDO` — identical, but re-introduces one `setInterval(2**31-1)` → does NOT hibernate.
 *                       Proves the test still catches a timer regression (the fix can't silently rot).
 *
 * `instanceId` is a per-construction uuid; it changes iff the DO was evicted and reconstructed.
 */
import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { WranglerDevServerService } from '@livestore/utils-dev/wrangler'
import {
  Effect,
  FetchHttpClient,
  Layer,
  Logger,
  LogLevel,
  RpcClient,
  RpcSerialization,
  Socket,
  Stream,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { HibRpcs } from './hibernation-rpc-fixtures/rpc-schema.ts'

const testTimeout = 60_000
const IDLE_MS = 13_000 // production hibernates after ~10s idle

const withWranglerTest = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    WranglerDevServerService.Default({
      cwd: `${import.meta.dirname}/hibernation-rpc-fixtures`,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer, Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    ),
})

const protocolFor = (path: string) =>
  Layer.suspend(() =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      return RpcClient.layerProtocolSocket().pipe(
        Layer.provide(Socket.layerWebSocket(`ws://localhost:${server.port}${path}`)),
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
        Layer.provide(RpcSerialization.layerJson),
      )
    }).pipe(Layer.unwrapEffect),
  )

/** Launch the real server, optionally keep a live pull open, idle, and report whether the DO reconstructed. */
const observeHibernation = ({ path, withLivePull }: { path: string; withLivePull: boolean }) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(HibRpcs)
    yield* client.Ping({})
    if (withLivePull) {
      yield* client.Live({}).pipe(Stream.runDrain, Effect.forkScoped)
      yield* Effect.sleep(500)
    }
    const { id: id1 } = yield* client.InstanceId({})
    yield* Effect.sleep(IDLE_MS)
    const { id: id2 } = yield* client.InstanceId({}) // wakes the DO; reconstructed ⇒ new id
    return { id1, id2, hibernated: id1 !== id2 }
  }).pipe(Effect.provide(protocolFor(path)))

Vitest.describe('real WS-RPC server hibernation OUTCOME (post-fix)', { timeout: testTimeout }, () => {
  Vitest.scopedLive('the fixed real server hibernates at idle and still serves RPC after wake', (test) =>
    Effect.gen(function* () {
      const r = yield* observeHibernation({ path: '/real', withLivePull: false })
      console.log('[hibernation-rpc] real (fixed):', r)
      // The DO was evicted and reconstructed across the idle window, yet the post-idle RPC succeeded.
      expect(r.hibernated).toBe(true)
    }).pipe(withWranglerTest(test)),
  )

  Vitest.scopedLive('regression sentinel (re-introduced timer) stays resident at idle', (test) =>
    Effect.gen(function* () {
      const r = yield* observeHibernation({ path: '/sentinel', withLivePull: false })
      console.log('[hibernation-rpc] sentinel (timer reintroduced):', r)
      // One pending long timer is enough to block hibernation: same instance handled both calls.
      expect(r.hibernated).toBe(false)
    }).pipe(withWranglerTest(test)),
  )
})
