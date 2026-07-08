/**
 * @fileoverview EMPIRICAL SPIKE — does local miniflare actually hibernate (evict) a hibernatable DO,
 * and does it enforce the pending-timer gate? Answers whether direct hibernation observation is even
 * possible locally, or whether we must rely on the timer-count proxy + production analytics.
 *
 * See `hibernation-probe-fixtures/worker.ts` for the two probe DOs.
 */
import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { WranglerDevServerService } from '@livestore/utils-dev/wrangler'
import { Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

const testTimeout = 60_000
const IDLE_MS = 13_000 // production hibernates after ~10s idle

const withWranglerTest = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    WranglerDevServerService.Default({
      cwd: `${import.meta.dirname}/hibernation-probe-fixtures`,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer, Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    ),
})

/** Opens one raw WebSocket and lets us ask the DO for its in-memory instanceId. */
const connect = (url: string) =>
  new Promise<{ ask: () => Promise<string>; close: () => void }>((resolve, reject) => {
    const ws = new WebSocket(url)
    const waiters: Array<(v: string) => void> = []
    ws.addEventListener('message', (e) => {
      const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
      waiters.shift()?.(data)
    })
    ws.addEventListener('open', () =>
      resolve({
        ask: () =>
          new Promise<string>((res) => {
            waiters.push(res)
            ws.send('id')
          }),
        close: () => ws.close(),
      }),
    )
    ws.addEventListener('error', (e) => reject(e))
  })

const probeReconstruction = (port: number, path: string) =>
  Effect.gen(function* () {
    const conn = yield* Effect.promise(() => connect(`ws://localhost:${port}${path}`))
    const id1 = yield* Effect.promise(() => conn.ask())
    yield* Effect.sleep(IDLE_MS)
    const id2 = yield* Effect.promise(() => conn.ask())
    conn.close()
    return { id1, id2, reconstructed: id1 !== id2 }
  })

Vitest.describe('SPIKE: can we observe DO hibernation locally?', { timeout: testTimeout }, () => {
  Vitest.scopedLive('control DO (no timers) reconstructs after idle → local DOES hibernate', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const r = yield* probeReconstruction(server.port, '/control')
      console.log('[probe] control (no timers):', r)
      expect(r.reconstructed).toBe(true)
    }).pipe(withWranglerTest(test)),
  )

  Vitest.scopedLive('timer DO (1 pending setInterval) stays resident after idle → gate enforced', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const r = yield* probeReconstruction(server.port, '/timer')
      console.log('[probe] timer (1 pending long setInterval):', r)
      expect(r.reconstructed).toBe(false)
    }).pipe(withWranglerTest(test)),
  )
})
