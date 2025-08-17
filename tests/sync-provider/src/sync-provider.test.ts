import { SyncBackend } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import {
  Effect,
  FetchHttpClient,
  type HttpClient,
  Layer,
  Logger,
  ManagedRuntime,
  Option,
  Stream,
} from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import * as CloudflareDoRpcProvider from './providers/cloudflare-do-rpc.ts'
import * as CloudflareHttpProvider from './providers/cloudflare-http-rpc.ts'
import * as CloudflareWsProvider from './providers/cloudflare-ws.ts'
import * as ElectricProvider from './providers/electric.ts'
import { SyncProviderImpl } from './types.ts'

const providerLayers = [
  // Keep as multi-line array to more easily comment-out providers for debugging
  CloudflareHttpProvider,
  CloudflareDoRpcProvider,
  CloudflareWsProvider,
  ElectricProvider,
]

const withTestCtx = ({ suffix }: { suffix?: string } = {}) =>
  Vitest.makeWithTestCtx({
    suffix,
    // timeout: testTimeout,
    // makeLayer: (testContext) => makeFileLogger('runner', { testContext }),
    makeLayer: (_testContext) => Logger.prettyWithThread('test-runner'),
    forceOtel: true,
  })

// Vitest.describe.each(providers)('$name sync provider', { timeout: 10000 }, ({ makeProvider, setup }) => {
Vitest.describe.each(providerLayers)('$name sync provider', { timeout: 10000, concurrent: false }, ({ layer }) => {
  let runtime: ManagedRuntime.ManagedRuntime<SyncProviderImpl | HttpClient.HttpClient, never>

  Vitest.beforeAll(async () => {
    runtime = ManagedRuntime.make(
      layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(OtelLiveHttp({ rootSpanName: 'beforeAll', serviceName: 'vitest-runner', skipLogUrl: false })),
        Layer.provideMerge(Logger.prettyWithThread('test-runner')),
        Layer.orDie,
      ),
    )
    // Eagerly start the runtime
    await runtime.runPromise(Effect.void)
  })

  Vitest.afterAll(async () => await runtime.dispose())

  const makeProvider = Effect.suspend(() =>
    Effect.andThen(SyncProviderImpl, (_) =>
      _.makeProvider({
        storeId: 'test-store',
        clientId: 'test-client',
        payload: undefined,
      }),
    ).pipe(Effect.provide(runtime)),
  )

  // Simple test to verify the setup works
  Vitest.scopedLive('can create sync backend', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider

      // Just verify we can create the backend
      expect(syncBackend).toBeDefined()
      expect(syncBackend.connect).toBeDefined()
      expect(syncBackend.pull).toBeDefined()
      expect(syncBackend.push).toBeDefined()
      expect(syncBackend.isConnected).toBeDefined()
    }).pipe(withTestCtx()(test)),
  )

  Vitest.scopedLive('can ping sync backend', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider

      yield* syncBackend.ping
    }).pipe(withTestCtx()(test)),
  )

  Vitest.scopedLive('can connect to sync backend', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider

      // Check initial state
      const initialConnected = yield* syncBackend.isConnected.get
      expect(initialConnected).toBe(false)

      // Connect
      yield* syncBackend.connect

      // Check connected state
      const connected = yield* syncBackend.isConnected
      expect(connected).toBe(true)
    }).pipe(withTestCtx()(test)),
  )

  Vitest.scopedLive('can pull events from sync backend', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider

      // Pull without cursor (initial sync)
      const events = yield* syncBackend.pull(Option.none()).pipe(Stream.take(1), Stream.runCollect)

      // Verify we got a valid response
      expect(events.length).toBeGreaterThanOrEqual(0)

      // Each item should have batch and remaining
      for (const item of events) {
        expect(item).toHaveProperty('batch')
        expect(item).toHaveProperty('remaining')
        expect(Array.isArray(item.batch)).toBe(true)
        expect(typeof item.remaining).toBe('number')
      }
    }).pipe(withTestCtx()(test)),
  )

  Vitest.scopedLive('can pull with cursor', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider

      yield* syncBackend.push([
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...events.todoCreated({ id: '1', text: 'Test event 1', completed: false }),
          clientId: 'test-client',
          sessionId: 'test-session',
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
        }),
      ])

      // First pull without cursor
      const firstPull = yield* syncBackend.pull(Option.none()).pipe(Stream.runHead, Effect.flatten)
      expect(firstPull.batch.length).toBe(1)

      // Pull with cursor from a specific position
      const cursorPull = yield* syncBackend
        .pull(SyncBackend.cursorFromPullResItem(firstPull))
        .pipe(Stream.runHead, Effect.flatten)

      // Both pulls should succeed
      expect(firstPull.batch.length).toBe(1)
      expect(cursorPull.batch.length).toBe(0)

      // Verify structure
      // for (const item of [...firstPull, ...cursorPull]) {
      //   expect(item).toHaveProperty('batch')
      //   expect(item).toHaveProperty('remaining')
      // }
    }).pipe(withTestCtx()(test)),
  )
})
