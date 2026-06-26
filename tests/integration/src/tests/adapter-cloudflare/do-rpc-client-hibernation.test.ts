/**
 * @fileoverview Regression guard for the DO-RPC client-host hibernation CONTRACT (livestorejs/livestore#1328,
 * #2/#4): a DO-resident livestore client's live pull is live ONLY while its store is resident (≈ a WebSocket
 * connection). Once the client-host DO hibernates, the next reverse-RPC update finds no live store, so the
 * client reports `syncUpdateRpc -> true` and the SyncBackendDO REAPS the subscription — the update is NOT
 * delivered live. Recovery is on next use: booting the store runs a catch-up pull from the cursor, so no
 * event is lost (there is deliberately no boot-on-wake auto-recovery).
 *
 * Topology — the external "browser" client is the SOLE writer; the store DO is a pure live-pull reader:
 *
 *   ┌──────────┐  WS push  ┌────────────────┐  reverse syncUpdateRpc  ┌──────────────┐
 *   │  vitest  │ ────────▶ │  SyncBackendDO │ ──────────────────────▶ │  TestStoreDo │
 *   │ (direct) │           └────────────────┘   (DO-to-DO RPC)        │ (livePull)   │
 *   └──────────┘                                                       └──────────────┘
 *
 * Live delivery is observed via the DO's NATIVE persisted `eventlog` row count, read WITHOUT booting the store
 * (`/store/eventlog`) — booting would trigger a catch-up pull that masks whether the LIVE path delivered.
 *
 * @see ./client-host-hibernation.test.ts — proves the client-host DO holds 0 long-period timers (can hibernate).
 * @see ../../../../../tests/sync-provider/src/do-rpc-hibernation.test.ts — the sync-DO-eviction + reap analogue.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from 'vitest'

import { EventFactory } from '@livestore/common/testing'
import { makeWsSync } from '@livestore/sync-cf/client'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Duration,
  Effect,
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  KeyValueStore,
  Layer,
  Option,
  Schedule,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'

import { events } from './schema.ts'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, 'fixtures')
const testTimeout = Duration.toMillis(Duration.seconds(90))

/** Production hibernates after ~10s idle; idle the client-host DO well past that. */
const CLIENT_IDLE_MS = 15_000

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
      // The direct `makeWsSync` sync backend (its backend-id helper) needs a KeyValueStore.
      KeyValueStore.layerMemory,
    ),
})

const EventlogSchema = Schema.Struct({
  instanceId: Schema.String,
  eventlogCount: Schema.Number,
})
const BootSchema = Schema.Struct({ instanceId: Schema.String })
const TodosSchema = Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))

const writer = EventFactory.clientIdentity('browser-client', 'browser-session')
const makeFactory = EventFactory.makeFactory(events)

const makeHelpers = (serverUrl: string, storeId: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest((req) =>
        req.pipe(HttpClientRequest.prependUrl(serverUrl), HttpClientRequest.setUrlParam('storeId', storeId)),
      ),
      HttpClient.filterStatusOk,
    )

    return {
      /** Boots the store DO as a pure-reader live-pull subscriber. Does NOT commit. */
      bootStore: () =>
        HttpClientRequest.post('/store/boot').pipe(
          HttpClientRequest.setUrlParam('livePull', 'true'),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(BootSchema)),
        ),
      /** Non-booting probe: per-instance uuid (eviction signal) + persisted native eventlog row count. */
      getEventlog: () =>
        client.get('/store/eventlog').pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(EventlogSchema))),
      /** Control: boots the store (catch-up pull) and returns the materialized todos. */
      getTodos: () => client.get('/store/todos').pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(TodosSchema))),
    }
  })

Vitest.describe('adapter-cloudflare — client-host hibernation (live-pull delivery)', { timeout: testTimeout }, () => {
  Vitest.live('live pull stops when the client-host DO hibernates; recovers via catch-up pull on next use', (test) =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServerService
      const storeId = `cf-client-hib-delivery-${nanoid(6)}`
      const { bootStore, getEventlog, getTodos } = yield* makeHelpers(server.url, storeId)

      // 1. Boot the store DO as a pure-reader live-pull subscriber (registers the reverse-RPC subscription).
      const boot = yield* bootStore()
      const instance1 = boot.instanceId
      // Give the leader's initial live pull a moment to register its subscription on the SyncBackendDO.
      yield* Effect.sleep('1 second')

      // 2. Direct "browser" writer — a second, independent WS sync connection straight to the SyncBackendDO.
      //    This is the SOLE writer, so it owns the eventlog sequence cleanly (no multi-writer conflicts).
      const directBackend = yield* makeWsSync({ url: server.url })({
        storeId,
        clientId: 'browser-client',
        payload: undefined,
      })
      yield* directBackend.connect
      // Drain the (empty) backlog once to establish the backendId used by subsequent pushes.
      yield* directBackend.pull(Option.none(), { live: false }).pipe(Stream.runDrain)

      const factory = makeFactory({ client: writer, startSeq: 1, initialParent: 'root' })

      // 3. Push `before-evict` and confirm it is delivered LIVE while the store DO is resident
      //    (the eventlog grows without us booting the store).
      yield* directBackend.push([factory.todoCreated.next({ id: 'before-evict', title: 'before' })])
      const afterBefore = yield* getEventlog().pipe(
        Effect.flatMap((r) =>
          r.eventlogCount >= 1 ? Effect.succeed(r) : Effect.fail(new Error(`eventlog ${r.eventlogCount} < 1`)),
        ),
        Effect.retry(Schedule.spaced('300 millis')),
        Effect.timeout('15 seconds'),
      )

      // 4. Idle the store DO past the eviction window WITHOUT touching any /store route. Keep only the
      //    direct WS warm (pings hit the SyncBackendDO, never the store DO), so the store DO evicts.
      yield* directBackend.ping.pipe(Effect.delay('3 seconds'), Effect.repeat(Schedule.recurs(4)))
      yield* Effect.sleep(`${CLIENT_IDLE_MS - 12_000} millis`)

      // 5. Prove the precondition: the store DO evicted+reconstructed (instanceId changed), and the
      //    persisted eventlog from before survived (count still 1).
      const afterEvict = yield* getEventlog()

      // 6. Push `after-evict` while the store DO is hibernated. The SyncBackendDO reverse-RPCs `syncUpdateRpc`
      //    to the reconstructed (storeless) DO, which returns `true` → the subscription is reaped and the
      //    event is NOT delivered live.
      yield* directBackend.push([factory.todoCreated.next({ id: 'after-evict', title: 'after' })])

      // 7. Give live delivery ample time, then confirm the eventlog did NOT grow on its own (no auto-recovery).
      yield* Effect.sleep('5 seconds')
      const afterAfter = yield* getEventlog()

      // 8. Control — booting the store (a catch-up pull) recovers `after-evict`, proving recovery-on-next-use.
      const todos = yield* getTodos()
      const todoIds = todos.map((t) => t.id)

      yield* Effect.promise(() =>
        test.annotate(
          `instance: boot=${instance1} afterEvict=${afterEvict.instanceId} (evicted=${afterEvict.instanceId !== instance1}). ` +
            `eventlogCount: afterBefore=${afterBefore.eventlogCount} afterEvict=${afterEvict.eventlogCount} ` +
            `afterAfter=${afterAfter.eventlogCount}. control todos=${JSON.stringify(todoIds)}.`,
        ),
      )

      // Preconditions: live delivery worked while resident, and the store DO actually hibernated.
      expect(afterBefore.eventlogCount, 'before-evict should be delivered live while resident').toBeGreaterThanOrEqual(
        1,
      )
      expect(afterEvict.instanceId, 'store DO should have evicted+reconstructed during the idle window').not.toBe(
        instance1,
      )

      // The contract: after-evict was pushed while hibernated → reaped, NOT delivered live. The eventlog
      // stays at its pre-hibernation count (no boot-on-wake auto-recovery).
      expect(
        afterAfter.eventlogCount,
        'after-evict must NOT be delivered live to a hibernated client (subscription reaped)',
      ).toBe(afterEvict.eventlogCount)

      // Recover-on-next-use: booting the store catches up via its initial pull, so no event is lost.
      expect(todoIds, 'control: booting the store recovers both events (catch-up pull)').toEqual(
        expect.arrayContaining(['before-evict', 'after-evict']),
      )
    }).pipe(withTestCtx(test)),
  )
})
