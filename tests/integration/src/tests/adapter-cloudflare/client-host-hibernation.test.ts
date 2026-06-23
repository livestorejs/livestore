/**
 * @fileoverview Regression guard for client-host DO hibernation.
 *
 * A Durable Object that *runs* a livestore client (`createStoreDoPromise` + DO-RPC sync) must not
 * pin itself resident. The sole steady-state park was the DO-RPC client transport's run-loop, which
 * `@effect/rpc`'s `withRun` held open with `Effect.never` — registering a pending `setInterval(2**31-1)`,
 * the exact disqualifier for Cloudflare DO hibernation/eviction. So the DO stayed resident and billed for
 * wall-clock forever. Client-side mirror of the sync-DO bug (#1328): same `Effect.never` root, different DO.
 *
 * The fix (`@livestore/common-cf` `layerProtocolDurableObject` -> `makeProtocol`) parks that run-loop on a
 * timer-less `Effect.async<never>` instead, so an idle DO-resident client holds 0 pending long-period
 * timers and can hibernate. (NB: `StoreRegistry.retain`'s `Effect.never` is NOT on this path — the CF
 * adapter `createStoreDo` calls `createStore` directly, not the registry.)
 *
 * We assert this runtime-faithfully (no flaky eviction observation) by counting pending long-period timers
 * from inside the isolate, before vs after booting the store. A non-zero count would mean "cannot hibernate"
 * and fail this test — guarding against a re-introduced `Effect.never`/`setInterval` park.
 *
 * @see ../../../../@livestore/common-cf/src/ws-rpc/hibernation-e2e.test.ts — the sync-server analogue.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Duration,
  Effect,
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Layer,
  Schema,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, 'fixtures')
const testTimeout = Duration.toMillis(Duration.seconds(60))

// Wrangler refuses to start when proxy environment variables are set, which can happen in CI.
delete process.env.HTTP_PROXY
delete process.env.http_proxy
delete process.env.HTTPS_PROXY
delete process.env.https_proxy
delete process.env.ALL_PROXY
delete process.env.all_proxy

const { WranglerDevServerService } = await import('@livestore/utils-dev/wrangler')

const withTestCtx = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    Layer.mergeAll(
      WranglerDevServerService.Default({
        cwd: fixturesDir,
        readiness: { connectTimeout: Duration.seconds(15) },
      }).pipe(Layer.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer))),
      FetchHttpClient.layer,
    ),
})

const InstanceSchema = Schema.Struct({ instanceId: Schema.String, longTimers: Schema.Number })

const makeHelpers = (serverUrl: string, storeId: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest((req) =>
        req.pipe(HttpClientRequest.prependUrl(serverUrl), HttpClientRequest.setUrlParam('storeId', storeId)),
      ),
      HttpClient.filterStatusOk,
    )

    return {
      /** Cheap probe: per-instance uuid + current long-period timer count. Does NOT boot the store. */
      getInstance: () =>
        client
          .get('/store/instance')
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(InstanceSchema))),

      /**
       * Boots the full Store inside the DO (DO-RPC sync to SyncBackendDO) and commits one event.
       * `livePull: true` mirrors the app's reactive client (reverse-RPC subscription via `syncUpdateRpc`).
       */
      createTodo: (id: string, title: string) =>
        HttpClientRequest.post('/store/todos').pipe(
          HttpClientRequest.setUrlParam('livePull', 'true'),
          HttpClientRequest.bodyJson({ id, title }),
          Effect.flatMap(client.execute),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ id: Schema.String }))),
        ),
    }
  })

Vitest.describe('adapter-cloudflare — client-host hibernation', { timeout: testTimeout }, () => {
  Vitest.live('DO running a livestore client holds NO pending long-period timers at idle (can hibernate)', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-client-hibernation-${nanoid(6)}`
      const { getInstance, createTodo } = yield* makeHelpers(server.url, storeId)

      // 1. Baseline — DO constructed but no store booted yet. No pending long-period timers.
      const baseline = yield* getInstance()
      expect(baseline.longTimers).toBe(0)

      // 2. Boot the full Store (this establishes the DO-RPC sync RpcClient connection).
      yield* createTodo('todo-1', 'first item')

      // 3. Let boot transients settle so we measure the STEADY-STATE idle park count.
      yield* Effect.sleep('3 seconds')

      const withStore = yield* getInstance()

      // The DO never evicted between these rapid calls — sanity check that the probe is stable.
      expect(withStore.instanceId).toBe(baseline.instanceId)

      yield* Effect.promise(() =>
        test.annotate(
          `long-period timers at idle: baseline=${baseline.longTimers}, with store=${withStore.longTimers}. ` +
            `Any > 0 == the client-host DO cannot hibernate (pending setInterval disqualifier).`,
        ),
      )

      // The DO-RPC sync `RpcClient` transport's run-loop is the only steady-state park here. Before the fix
      // it parked on `@effect/rpc`'s `withRun` `Effect.never` (a `setInterval(2**31-1)`); now it parks on a
      // timer-less `Effect.async<never>` via `layerProtocolDurableObject` -> `makeProtocol` (client analogue
      // of the sync-server #1328 ③ fix). So an idle DO-resident client leaves 0 pending long-period timers
      // and can hibernate. A re-introduced `Effect.never`/`setInterval` park would bump this above 0 and fail.
      //
      // (`StoreRegistry.retain`'s `Effect.never` is NOT on this path — `createStoreDo` uses `createStore`
      // directly; and the `livePull: true` reverse-RPC subscription is held open with `Mailbox.toStream`,
      // which is timer-less — so neither contributes a long-period timer.)
      expect(withStore.longTimers).toBe(0)
    }).pipe(withTestCtx(test)),
  )
})
