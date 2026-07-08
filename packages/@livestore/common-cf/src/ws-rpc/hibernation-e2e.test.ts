/**
 * @fileoverview End-to-end reproduction of the DO hibernation disqualifier in a real workerd isolate.
 *
 * Runs the actual `@livestore/sync-cf`-style WS-RPC server inside `wrangler dev` (workerd/miniflare)
 * and measures, from inside the DO isolate, the number of pending long-period `setInterval` timers —
 * the exact condition Cloudflare checks before hibernating a DO.
 *
 * An idle connected client with one live pull holds 3 such timers:
 *   - `Layer.launch(ServerLive)`      (common-cf  ws-rpc-server.ts)
 *   - `Stream.concat(Stream.never)`   (sync-cf    live Pull handler — emulated here by `Live`)
 *   - `withRun`'s `Effect.onExit(Effect.never, …)` (@effect/rpc RpcServer run park)
 *
 * Because any pending timer > 0 disqualifies hibernation, this test pins the bug runtime-faithfully
 * without relying on observing eviction (which workerd does not surface reliably).
 *
 * See `hibernation-timers.test.ts` for the fast, in-process decomposition of the same parks.
 */
import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { WranglerDevServerService } from '@livestore/utils-dev/wrangler'
import {
  Effect,
  Fiber,
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

import { TestRpcs } from './test-fixtures/rpc-schema.ts'

const testTimeout = 60_000

const withWranglerTest = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    WranglerDevServerService.Default({
      cwd: `${import.meta.dirname}/test-fixtures`,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer, Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    ),
})

const ProtocolLive = Layer.suspend(() =>
  Effect.gen(function* () {
    const server = yield* WranglerDevServerService
    return RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(`ws://localhost:${server.port}`)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    )
  }).pipe(Layer.unwrapEffect),
)

Vitest.describe('DO WebSocket hibernation — real workerd, post-fix is timer-less', { timeout: testTimeout }, () => {
  Vitest.scopedLive('idle live connection leaves 0 pending long-period timers (hibernatable)', (test) =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TestRpcs)

      // 1. Establish the connection / launch the WS-RPC server.
      yield* client.Ping({ message: 'launch' })
      yield* Effect.sleep(300)

      const baseline = yield* client.GetLongTimerCount({})
      expect(baseline.count).toBe(0)

      // 2. Open a live pull and keep it open in the background (emits backlog, then holds timer-lessly).
      const liveFiber = yield* client.Live({}).pipe(Stream.runDrain, Effect.forkScoped)
      yield* Effect.sleep(500)

      const withLive = yield* client.GetLongTimerCount({})
      expect(withLive.count).toBe(0)

      // 3. Cleanly closes; still 0.
      yield* Fiber.interrupt(liveFiber)
      yield* Effect.sleep(500)
      const afterClose = yield* client.GetLongTimerCount({})
      expect(afterClose.count).toBe(0)
    }).pipe(Effect.provide(ProtocolLive), withWranglerTest(test)),
  )
})
