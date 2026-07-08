/**
 * @fileoverview Isolated, unbiased reproduction of the DO-RPC live-pull subscription loss across
 * sync-DO hibernation (follow-up to livestorejs/livestore#1328).
 *
 * The bug: a livestore client running inside another DO that subscribes to the sync backend via
 * DO-to-DO RPC live pull stops receiving events once the sync DO goes idle and evicts — because the
 * sync DO's subscription registry (`rpcSubscriptions`) is in-memory only and is wiped on eviction,
 * unlike the WebSocket path which re-enumerates `ctx.getWebSockets()` after wake.
 *
 * Topology (the existing DO-RPC provider proxy):
 *
 *   ┌──────────┐  WS RPC   ┌────────────────┐  DO RPC   ┌────────────────┐
 *   │  vitest  │ ────────▶ │  TestClientDo  │ ────────▶ │  SyncBackendDO │
 *   └──────────┘  (pull)   └────────────────┘  ◀ syncUpdateRpc (reverse) ┘
 *
 * This test PROVES the precondition rather than assuming it: a non-persisted per-instance id on each
 * DO shows the sync DO actually reconstructed (evicted) while the client DO stayed resident. A fresh
 * non-live pull is used as a control to show the server really stored the post-eviction event — so the
 * only thing that failed is live delivery over the (lost) subscription.
 */
import { expect } from 'vitest'

import { EventFactory } from '@livestore/common/testing'
import { nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Effect,
  FetchHttpClient,
  type HttpClient,
  KeyValueStore,
  Layer,
  Logger,
  LogLevel,
  ManagedRuntime,
  Option,
  Schedule,
  Stream,
} from '@livestore/utils/effect'

import * as CloudflareDoRpcProvider from './providers/cloudflare-do-rpc.ts'
import { SyncProviderImpl } from './types.ts'

const testTimeout = 90_000
/** Production hibernates after ~10s idle; idle the sync DO well past that (matches the hibernation probe). */
const SERVER_IDLE_MS = 15_000

const client = EventFactory.clientIdentity('repro-client', 'repro-session')
const makeFactory = EventFactory.makeFactory(events)

const todoId = (item: { eventEncoded: unknown }): string | undefined =>
  (item.eventEncoded as { args?: { id?: string } })?.args?.id

Vitest.describe('DO-RPC live pull across sync-DO hibernation', { timeout: testTimeout }, () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    SyncProviderImpl | HttpClient.HttpClient | KeyValueStore.KeyValueStore,
    never
  >

  Vitest.beforeAll(async () => {
    runtime = ManagedRuntime.make(
      CloudflareDoRpcProvider.doSqlite.layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provideMerge(KeyValueStore.layerMemory),
        Layer.provide(OtelLiveHttp({ rootSpanName: 'beforeAll', serviceName: 'vitest-runner', skipLogUrl: false })),
        Layer.provide(Logger.prettyWithThread('test-runner')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
        Layer.orDie,
      ),
    )
    await runtime.runPromise(Effect.void)
  })

  Vitest.afterAll(async () => await runtime.dispose())

  Vitest.scopedLive('resident DO-RPC client stops receiving live events after the sync DO evicts', (test) =>
    Effect.gen(function* () {
      const { makeProvider, port } = yield* SyncProviderImpl.pipe(
        Effect.map((_) => ({ makeProvider: _.makeProvider, port: _.providerSpecific.port as number })),
      )

      // Unique per run so persisted DO state from a prior run can't poison the head (ServerAheadError).
      const storeId = `do-rpc-hibernation-${nanoid()}`
      const factory = makeFactory({ client, startSeq: 1, initialParent: 'root' })
      const base = `http://localhost:${port}`
      const getJson = (path: string): Effect.Effect<any> =>
        Effect.promise(() => fetch(`${base}${path}`).then((r) => r.json()))

      const syncBackend = yield* makeProvider({ storeId, clientId: client.clientId, payload: undefined })

      // Collect every todo id the live pull delivers, into a shared array.
      const received: string[] = []
      yield* syncBackend.pull(Option.none(), { live: true }).pipe(
        Stream.runForEach((res) =>
          Effect.sync(() => {
            for (const item of res.batch) {
              const id = todoId(item)
              if (id !== undefined) received.push(id)
            }
          }),
        ),
        Effect.forkScoped,
      )

      // Let the initial (live) pull register its subscription on the sync DO before pushing.
      yield* Effect.sleep('1 second')

      // 1. Baseline — push an event and confirm it IS delivered live (the subscription channel works).
      yield* syncBackend.push([factory.todoCreated.next({ id: 'before-evict', text: 'before', completed: false })])
      yield* Effect.sync(() => received.includes('before-evict')).pipe(
        Effect.flatMap((ok) => (ok === true ? Effect.void : Effect.fail(new Error('not yet delivered')))),
        Effect.retry(Schedule.spaced('300 millis')),
        Effect.timeout('10 seconds'),
      )

      // 2. Snapshot instance ids (precondition baseline).
      const serverId1 = (yield* getJson(`/instance/sync?storeId=${storeId}`)).instanceId as string
      const clientId1 = (yield* getJson('/instance/client')).instanceId as string

      // 3. Idle the SYNC DO past the eviction window, while keeping the CLIENT DO warm
      //    (ping /instance/client — a local no-op that never touches the sync DO).
      yield* getJson('/instance/client').pipe(Effect.delay('3 seconds'), Effect.repeat(Schedule.recurs(4)))
      yield* Effect.sleep(`${SERVER_IDLE_MS - 12_000} millis`)

      // 4. PROVE the precondition: sync DO reconstructed (evicted), client DO stayed resident.
      const serverId2 = (yield* getJson(`/instance/sync?storeId=${storeId}`)).instanceId as string
      const clientId2 = (yield* getJson('/instance/client')).instanceId as string
      expect(serverId2, 'sync DO should have evicted+reconstructed (new instance id)').not.toBe(serverId1)
      expect(clientId2, 'client DO should have stayed resident (same instance id)').toBe(clientId1)

      // 5. Push a new event AFTER the sync DO evicted.
      yield* syncBackend.push([factory.todoCreated.next({ id: 'after-evict', text: 'after', completed: false })])

      // 6. Give live delivery ample time (baseline took <1s).
      yield* Effect.sleep('4 seconds')

      // 7. Control — the server DID store the post-eviction event (a fresh non-live pull returns it),
      //    so the ONLY thing that failed is live delivery over the lost subscription.
      const stored = yield* syncBackend.pull(Option.none(), { live: false }).pipe(
        Stream.runFold([] as string[], (acc, res) => {
          for (const item of res.batch) {
            const id = todoId(item)
            if (id !== undefined) acc.push(id)
          }
          return acc
        }),
      )
      expect(stored, 'server should have stored both events').toEqual(
        expect.arrayContaining(['before-evict', 'after-evict']),
      )

      yield* Effect.logInfo('[do-rpc-hibernation] repro evidence', {
        serverEvicted: serverId1 !== serverId2,
        clientResident: clientId1 === clientId2,
        liveReceived: received,
        storedOnServer: stored,
      })

      // 8. The bug: the resident DO-RPC client received the pre-eviction event but NOT the post-eviction one.
      expect(received, 'live pull received the pre-eviction event').toContain('before-evict')
      expect(received, 'live pull should have received the post-eviction event (currently lost)').toContain(
        'after-evict',
      )
    }).pipe(Effect.provide(runtime)),
  )

  // Reaping (#2/#4): once the client reports its store is gone, the sync DO must drop the persisted
  // subscription (else dead clients wake on every push forever); recovery is a catch-up pull on next use.
  Vitest.scopedLive(
    'reaps a DO-RPC subscription when the client reports its store is gone (recover on next use)',
    (test) =>
      Effect.gen(function* () {
        const { makeProvider, port } = yield* SyncProviderImpl.pipe(
          Effect.map((_) => ({ makeProvider: _.makeProvider, port: _.providerSpecific.port as number })),
        )

        const storeId = `do-rpc-reap-${nanoid()}`
        const factory = makeFactory({ client, startSeq: 1, initialParent: 'root' })
        const base = `http://localhost:${port}`
        const getJson = (path: string): Effect.Effect<any> =>
          Effect.promise(() => fetch(`${base}${path}`).then((r) => r.json()))
        const subCount = () =>
          getJson(`/rpc-subscriptions/count?storeId=${storeId}`).pipe(Effect.map((r) => r.count as number))

        yield* getJson('/do-rpc/open') // Order-independence: start with a live store.

        const syncBackend = yield* makeProvider({ storeId, clientId: client.clientId, payload: undefined })

        const received: string[] = []
        yield* syncBackend.pull(Option.none(), { live: true }).pipe(
          Stream.runForEach((res) =>
            Effect.sync(() => {
              for (const item of res.batch) {
                const id = todoId(item)
                if (id !== undefined) received.push(id)
              }
            }),
          ),
          Effect.forkScoped,
        )

        yield* Effect.sleep('1 second') // let the live pull register its subscription

        yield* syncBackend.push([factory.todoCreated.next({ id: 'live-1', text: 'one', completed: false })])
        yield* Effect.sync(() => received.includes('live-1')).pipe(
          Effect.flatMap((ok) => (ok === true ? Effect.void : Effect.fail(new Error('not yet delivered')))),
          Effect.retry(Schedule.spaced('300 millis')),
          Effect.timeout('10 seconds'),
        )
        const countAfterBaseline = yield* subCount()
        expect(countAfterBaseline, 'one DO-RPC subscription registered').toBe(1)

        // Close the store → the gate now reports the subscription should be reaped.
        yield* getJson('/do-rpc/close')

        yield* syncBackend.push([factory.todoCreated.next({ id: 'after-close', text: 'after', completed: false })])

        yield* subCount().pipe(
          Effect.flatMap((c) => (c === 0 ? Effect.void : Effect.fail(new Error(`still ${c} subscription(s)`)))),
          Effect.retry(Schedule.spaced('300 millis')),
          Effect.timeout('10 seconds'),
        )

        expect(received, 'closed client should not receive the post-close event live').not.toContain('after-close')

        // Recover-on-next-use: the server stored it, so a fresh non-live pull returns everything.
        const stored = yield* syncBackend.pull(Option.none(), { live: false }).pipe(
          Stream.runFold([] as string[], (acc, res) => {
            for (const item of res.batch) {
              const id = todoId(item)
              if (id !== undefined) acc.push(id)
            }
            return acc
          }),
        )
        expect(stored, 'server stored both events (recover-on-next-use)').toEqual(
          expect.arrayContaining(['live-1', 'after-close']),
        )

        yield* Effect.logInfo('[do-rpc-reap] evidence', { liveReceived: received, storedOnServer: stored })

        yield* getJson('/do-rpc/open') // Restore for later tests.
      }).pipe(Effect.provide(runtime)),
  )
})
