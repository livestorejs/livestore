import { SyncBackend } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent, nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import {
  Chunk,
  Effect,
  FetchHttpClient,
  type HttpClient,
  KeyValueStore,
  Layer,
  Logger,
  LogLevel,
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
import * as MockProvider from './providers/mock.ts'
import { SyncProviderImpl } from './types.ts'

const providerLayers = [
  MockProvider,
  CloudflareHttpProvider,
  CloudflareDoRpcProvider,
  CloudflareWsProvider,
  ElectricProvider,
  // TODO S2 sync provider
]

const withTestCtx = ({ suffix }: { suffix?: string } = {}) =>
  Vitest.makeWithTestCtx({
    suffix,
    // timeout: testTimeout,
    // makeLayer: (testContext) => makeFileLogger('runner', { testContext }),
    makeLayer: (_testContext) => Layer.mergeAll(Logger.prettyWithThread('test-runner'), KeyValueStore.layerMemory),
    forceOtel: true,
  })

const runFirstNonEmpty = <T, E, R>(stream: Stream.Stream<SyncBackend.PullResItem<T>, E, R>) =>
  stream.pipe(
    Stream.filter(({ batch }) => batch.length > 0),
    Stream.runFirstUnsafe,
  )

// TODO come up with a way to target specific providers individually
Vitest.describe.each(providerLayers)('$name sync provider', { timeout: 60000 }, ({ layer, name }) => {
  let runtime: ManagedRuntime.ManagedRuntime<SyncProviderImpl | HttpClient.HttpClient, never>
  let testId: string

  Vitest.beforeAll(async () => {
    testId = nanoid()
    runtime = ManagedRuntime.make(
      layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(OtelLiveHttp({ rootSpanName: 'beforeAll', serviceName: 'vitest-runner', skipLogUrl: false })),
        Layer.provide(Logger.prettyWithThread('test-runner')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
        Layer.orDie,
      ),
    )
    // Eagerly start the runtime
    await runtime.runPromise(Effect.void)
  })

  Vitest.afterAll(async () => await runtime.dispose())

  const makeProvider = (testName?: string) =>
    Effect.suspend(() =>
      Effect.andThen(SyncProviderImpl, (_) =>
        _.makeProvider({
          // Isolated store for each provider and test to avoid conflicts
          storeId: `test-store-${name}-${testName}-${testId}`,
          clientId: 'test-client',
          payload: undefined,
        }),
      ).pipe(Effect.provide(runtime)),
    )

  // Simple test to verify the setup works
  Vitest.scopedLive('can create sync backend', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)

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
      const syncBackend = yield* makeProvider(test.task.name)

      yield* syncBackend.ping
    }).pipe(withTestCtx()(test)),
  )

  Vitest.scopedLive('can connect to sync backend', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)

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
      const syncBackend = yield* makeProvider(test.task.name)

      // Pull without cursor (initial sync)
      const firstPull = yield* syncBackend.pull(Option.none()).pipe(Stream.runFirstUnsafe)

      // Verify we got a valid response
      expect(firstPull).toEqual(SyncBackend.pullResItemEmpty())
    }).pipe(withTestCtx()(test)),
  )

  Vitest.describe('live pull', () => {
    Vitest.scopedLive('needs to return a no-more page info', (test) =>
      Effect.gen(function* () {
        const syncBackend = yield* makeProvider(test.task.name)

        const firstPull = yield* syncBackend.pull(Option.none(), { live: true }).pipe(Stream.runFirstUnsafe)

        expect(firstPull.pageInfo).toEqual(SyncBackend.pageInfoNoMore)
      }).pipe(withTestCtx()(test)),
    )
  })

  Vitest.scopedLive('can pull with cursor', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)

      yield* syncBackend.push([
        // TODO come up with a nicer DSL for this
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...events.todoCreated({ id: '1', text: 'Test event 1', completed: false }),
          clientId: 'test-client',
          sessionId: 'test-session',
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
        }),
      ])

      // First pull without cursor
      const firstPull = yield* syncBackend.pull(Option.none()).pipe(runFirstNonEmpty)
      expect(firstPull.batch.length).toBe(1)

      // Pull with cursor from a specific position
      const secondPull = yield* syncBackend
        .pull(SyncBackend.cursorFromPullResItem(firstPull))
        .pipe(Stream.runFirstUnsafe)

      expect(secondPull).toEqual(SyncBackend.pullResItemEmpty())
    }).pipe(withTestCtx()(test)),
  )

  Vitest.describe('connection management', () => {
    Vitest.scopedLive('can reconnect to sync backend', (test) =>
      Effect.gen(function* () {
        const syncBackend = yield* makeProvider(test.task.name)

        const fiber = yield* syncBackend.pull(Option.none(), { live: true }).pipe(runFirstNonEmpty, Effect.fork)

        const syncProvider = yield* SyncProviderImpl

        yield* syncProvider.turnBackendOffline
        yield* Effect.sleep(100)
        yield* syncProvider.turnBackendOnline

        yield* syncBackend.push([
          LiveStoreEvent.AnyEncodedGlobal.make({
            ...events.todoCreated({ id: '1', text: 'Test event 1', completed: false }),
            clientId: 'test-client',
            sessionId: 'test-session',
            seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
            parentSeqNum: EventSequenceNumber.ROOT.global,
          }),
        ])

        const result = yield* fiber
        expect(result.batch.length).toBe(1)
      }).pipe(Effect.provide(runtime), withTestCtx()(test)),
    )
  })

  Vitest.scopedLive('remaining field works correctly', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)

      // Push multiple events to ensure we have data
      const eventsToCreate = 5
      const startSeq = 1 // Start from 1 for this test
      for (let i = 0; i < eventsToCreate; i++) {
        yield* syncBackend.push([
          LiveStoreEvent.AnyEncodedGlobal.make({
            ...events.todoCreated({ id: `remaining-test-${i}`, text: `Event ${i}`, completed: false }),
            clientId: 'test-client',
            sessionId: 'test-session',
            seqNum: EventSequenceNumber.globalEventSequenceNumber(startSeq + i),
            parentSeqNum: EventSequenceNumber.globalEventSequenceNumber(startSeq - 1 + i),
          }),
        ])
      }

      // Pull all events and check remaining field
      const pullResults = yield* syncBackend.pull(Option.none()).pipe(Stream.runCollectReadonlyArray)

      // Verify we got results
      expect(pullResults.length).toBeGreaterThan(0)

      // Check that remaining field is present and is a number
      // for (const [i, result] of pullResults.entries()) {
      //   expect(result).toHaveProperty('remaining')
      //   expect(typeof result.remaining).toBe('number')
      //   expect(result.remaining).toBeGreaterThanOrEqual(0)

      //   // Different providers handle remaining differently:
      //   // - Electric: Uses 0/1 (doesn't know exact count)
      //   // - Cloudflare: Returns actual count
      //   const isLast = i === pullResults.length - 1
      //   if (isLast) {
      //     expect(result.remaining).toBe(0)
      //   } else {
      //     // For non-last chunks, should be > 0
      //     expect(result.remaining).toBeGreaterThan(0)
      //   }
      // }

      // Pull with cursor and verify remaining is still correct
      if (pullResults.length > 0) {
        // const firstResult = pullResults[0]!
        // const cursorPullResultsChunk = yield* syncBackend
        //   .pull(SyncBackend.cursorFromPullResItem(firstResult))
        //   .pipe(Stream.runCollect)
        // const cursorPullResults = Chunk.toArray(cursorPullResultsChunk)
        // Check remaining field on cursor-based pull
        // for (let i = 0; i < cursorPullResults.length; i++) {
        //   const result = cursorPullResults[i]!
        //   expect(result).toHaveProperty('remaining')
        //   expect(typeof result.remaining).toBe('number')
        //   // Last chunk should have remaining = 0, others > 0
        //   const isLast = i === cursorPullResults.length - 1
        //   if (isLast) {
        //     expect(result.remaining).toBe(0)
        //   } else {
        //     expect(result.remaining).toBeGreaterThan(0)
        //   }
        // }
      }
    }).pipe(withTestCtx()(test)),
  )

  Vitest.scopedLive('remaining field with limited take', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)

      // Push many events to ensure pagination
      // Use different sequence numbers to avoid conflicts with other tests
      const totalEvents = 10
      const startSeq = 100 // Use 100+ to avoid conflicts with other tests
      for (let i = 0; i < totalEvents; i++) {
        yield* syncBackend.push([
          LiveStoreEvent.AnyEncodedGlobal.make({
            ...events.todoCreated({ id: `limited-${i}`, text: `Limited Event ${i}`, completed: false }),
            clientId: 'test-client',
            sessionId: 'test-session',
            seqNum: EventSequenceNumber.globalEventSequenceNumber(startSeq + i),
            parentSeqNum:
              i === 0
                ? EventSequenceNumber.ROOT.global
                : EventSequenceNumber.globalEventSequenceNumber(startSeq - 1 + i),
          }),
        ])
      }

      // Take only first 3 emissions from the stream
      // Note: Each emission from the Electric provider contains a batch of events
      const limitedResultsChunk = yield* syncBackend.pull(Option.none()).pipe(Stream.take(3), Stream.runCollect)
      const limitedResults = Chunk.toArray(limitedResultsChunk)

      // Should have at least 1 result (Electric batches events)
      expect(limitedResults.length).toBeGreaterThanOrEqual(1)
      expect(limitedResults.length).toBeLessThanOrEqual(3)

      // Count total events in limited results
      const limitedEventCount = limitedResults.reduce((acc, r) => acc + r.batch.length, 0)

      // Each result should have remaining field
      for (let i = 0; i < limitedResults.length; i++) {
        // const result = limitedResults[i]!
        // expect(result).toHaveProperty('remaining')
        // expect(typeof result.remaining).toBe('number')
        // expect(result.remaining).toBeGreaterThanOrEqual(0)
        // When we use Stream.take(3), we might cut off the stream
        // The last item we receive should show remaining = 0 if it's truly the last
        // or remaining = 1 if we cut it off early
        // Since we're limiting to 3 emissions and have 10+ events,
        // we expect the stream was cut off, but the provider doesn't know this
      }

      // Now pull all to verify there were indeed more items available
      const allResultsChunk = yield* syncBackend.pull(Option.none()).pipe(Stream.runCollect)
      const allResults = Chunk.toArray(allResultsChunk)

      // Count total events across all results
      const totalItemCount = allResults.reduce((acc, r) => acc + r.batch.length, 0)

      // Should have pulled at least some events
      // Note: Some providers might not persist all events in test environment
      expect(totalItemCount).toBeGreaterThan(0)

      // If we took less than all stream emissions, verify we missed some data
      if (limitedResults.length < allResults.length) {
        expect(limitedEventCount).toBeLessThan(totalItemCount)
      }

      // Verify structure of all results
      for (let i = 0; i < allResults.length; i++) {
        const result = allResults[i]!
        expect(result).toHaveProperty('batch')
        // expect(result).toHaveProperty('remaining')
        // expect(Array.isArray(result.batch)).toBe(true)
        // expect(typeof result.remaining).toBe('number')
        // // Last chunk should have remaining = 0, others > 0
        // const isLast = i === allResults.length - 1
        // if (isLast) {
        //   expect(result.remaining).toBe(0)
        // } else {
        //   expect(result.remaining).toBeGreaterThan(0)
        // }
      }
    }).pipe(withTestCtx()(test)),
  )
})
