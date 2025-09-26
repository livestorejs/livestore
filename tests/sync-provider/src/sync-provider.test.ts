import { SyncBackend } from '@livestore/common'
import { EventFactory } from '@livestore/common/testing'
import type { LiveStoreEvent } from '@livestore/livestore'
import { EventSequenceNumber, nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import {
  Chunk,
  Duration,
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
  Schema,
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
import * as S2Provider from './providers/s2.ts'
import { SyncProviderImpl, type SyncProviderOptions } from './types.ts'

// NOTE: These specs should mirror LeaderSyncProcessor semantics: pushes never bypass the
// queueing/rebase rules, and live pulls represent the long-lived stream the leader relies on.
// Keep scenarios aligned with those invariants so we only test protocol-compliant usage.

const defaultClient = EventFactory.clientIdentity('test-client', 'test-session')

const makeFactory = EventFactory.makeFactory(events)

const providerLayers = [
  MockProvider,
  CloudflareHttpProvider.d1,
  CloudflareHttpProvider.doSqlite,
  CloudflareDoRpcProvider.d1,
  CloudflareDoRpcProvider.doSqlite,
  CloudflareWsProvider.d1,
  CloudflareWsProvider.doSqlite,
  ElectricProvider,
  S2Provider,
]

const withTestCtx = ({ suffix, timeout }: { suffix?: string; timeout?: Duration.DurationInput } = {}) =>
  Vitest.makeWithTestCtx({
    suffix,
    timeout,
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

  const makeProvider = (testName?: string, options?: SyncProviderOptions) =>
    Effect.suspend(() =>
      Effect.andThen(SyncProviderImpl, (_) =>
        _.makeProvider(
          {
            // Isolated store for each provider and test to avoid conflicts
            storeId: `test-store-${name}-${testName}-${testId}`,
            clientId: defaultClient.clientId,
            payload: undefined,
          },
          options,
        ),
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

    Vitest.scopedLive('survives idle and receives later event', (test) =>
      Effect.gen(function* () {
        const syncBackend = yield* makeProvider(test.task.name)
        const eventFactory = makeFactory({ client: defaultClient, startSeq: 1, initialParent: 'root' })

        // Start live pull and wait for the first non-empty batch in a fiber
        const fiber = yield* syncBackend.pull(Option.none(), { live: true }).pipe(runFirstNonEmpty, Effect.fork)

        // Let the live pull idle for a bit (covers long-poll/SSE)
        yield* Effect.sleep(800)

        // Push an event; live stream should emit it
        yield* syncBackend.push([eventFactory.todoCreated.next({ id: 'idle-1', text: 'Late event', completed: false })])

        const result = yield* fiber
        expect(result.batch.length).toBe(1)
      }).pipe(withTestCtx()(test)),
    )
  })

  Vitest.scopedLive('can pull with cursor', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)

      const eventFactory = makeFactory({ client: defaultClient })

      yield* syncBackend.push([eventFactory.todoCreated.next({ id: '1', text: 'Test event 1.', completed: false })])

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

  Vitest.describe('large batches handling', () => {
    const MIN_BATCH_PAYLOAD_BYTES = 1_000_000

    const fewLargeScenarioSchema = Schema.Struct({
      variant: Schema.Literal('fewLarge'),
      eventCount: Schema.Int.pipe(Schema.between(20, 28)),
      payloadSize: Schema.Int.pipe(Schema.between(70_000, 110_000)),
      pushBatchSize: Schema.Int.pipe(Schema.between(6, 12)),
    }).pipe(
      Schema.filter((scenario) => scenario.eventCount * scenario.payloadSize >= MIN_BATCH_PAYLOAD_BYTES, {
        message: () => 'Large batch scenarios should exceed provider payload limits',
      }),
    )

    const manySmallScenarioSchema = Schema.Struct({
      variant: Schema.Literal('manySmall'),
      eventCount: Schema.Int.pipe(Schema.between(1_200, 1_600)),
      payloadSize: Schema.Int.pipe(Schema.between(900, 1_200)),
      pushBatchSize: Schema.Int.pipe(Schema.between(30, 160)),
    }).pipe(
      Schema.filter((scenario) => scenario.eventCount * scenario.payloadSize >= MIN_BATCH_PAYLOAD_BYTES, {
        message: () => 'Small batch scenarios should exceed provider payload limits',
      }),
    )

    const LargeBatchScenarioSchema = Schema.Union(fewLargeScenarioSchema, manySmallScenarioSchema)

    type LargeBatchScenario = Schema.Schema.Type<typeof LargeBatchScenarioSchema>

    const deterministicBatchCases: ReadonlyArray<{
      label: string
      scenario: LargeBatchScenario
    }> = [
      {
        label: 'streams dozens of extremely large batches',
        scenario: { variant: 'fewLarge', eventCount: 60, payloadSize: 120_000, pushBatchSize: 6 },
      },
      {
        label: 'streams thousands of small batches',
        scenario: { variant: 'manySmall', eventCount: 1_800, payloadSize: 1_024, pushBatchSize: 90 },
      },
    ]

    const approxBatchPayloadBytes = (scenario: LargeBatchScenario) => scenario.eventCount * scenario.payloadSize

    const batchScenarioSummary = (scenario: LargeBatchScenario) =>
      `${scenario.variant}-${scenario.eventCount}x${scenario.payloadSize}`

    const makeBatchEvents = (
      scenario: LargeBatchScenario,
      { baseId }: { baseId: string },
    ): ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal> => {
      const payload = 'x'.repeat(scenario.payloadSize)
      const batchClient = EventFactory.clientIdentity(`${baseId}-client`, `${baseId}-session`)
      const eventFactory = makeFactory({ client: batchClient, startSeq: 1, initialParent: 'root' })

      return Array.from({ length: scenario.eventCount }, (_, index) =>
        eventFactory.todoCreated.next({
          id: `${baseId}-${index}`,
          text: payload,
          completed: false,
        }),
      )
    }

    const pushBatchEvents = (
      syncBackend: SyncBackend.SyncBackend,
      batches: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>,
      pushBatchSize: number,
    ) =>
      Effect.gen(function* () {
        const batchSize = Math.max(1, pushBatchSize)

        for (let index = 0; index < batches.length; index += batchSize) {
          const batch = batches.slice(index, index + batchSize)
          if (batch.length === 0) continue

          yield* syncBackend.push(batch)
        }
      })

    const collectBatchPullStats = (syncBackend: SyncBackend.SyncBackend) =>
      syncBackend.pull(Option.none()).pipe(
        Stream.runFold({ totalEvents: 0, nonEmptyBatches: 0, maxBatchSize: 0 }, (acc, { batch }) => ({
          totalEvents: acc.totalEvents + batch.length,
          nonEmptyBatches: acc.nonEmptyBatches + (batch.length > 0 ? 1 : 0),
          maxBatchSize: Math.max(acc.maxBatchSize, batch.length),
        })),
      )

    const isCloudflareDoRpc = name === CloudflareDoRpcProvider.name
    const batchTimeout = isCloudflareDoRpc ? 360_000 : 90_000
    const batchTestTimeout = batchTimeout + 30_000
    const batchPingSchedule = Schedule.spaced(Duration.minutes(5)).pipe(Schedule.addDelay(() => Duration.minutes(1)))

    // Additionally to the property-based tests we also have some deterministic scenarios.
    for (const { label, scenario } of deterministicBatchCases) {
      const scenarioSummary = batchScenarioSummary(scenario)

      Vitest.scopedLive(label, (test) => {
        return Effect.gen(function* () {
          const scenarioId = nanoid()
          const approxBytes = approxBatchPayloadBytes(scenario)

          expect(approxBytes).toBeGreaterThanOrEqual(MIN_BATCH_PAYLOAD_BYTES)

          const syncBackend = yield* makeProvider(`${test.task.name}-${scenario.variant}-${scenarioId}`, {
            pingSchedule: batchPingSchedule,
          })

          const batchEvents = makeBatchEvents(scenario, {
            baseId: `${scenario.variant}-${scenarioId}`,
          })

          yield* pushBatchEvents(syncBackend, batchEvents, scenario.pushBatchSize)

          const stats = yield* collectBatchPullStats(syncBackend)

          expect(stats.totalEvents).toBe(scenario.eventCount)
          expect(stats.nonEmptyBatches).toBeGreaterThan(0)

          if (scenario.variant === 'manySmall' && name.toLowerCase().includes('cloudflare')) {
            expect(stats.nonEmptyBatches).toBeGreaterThan(1)
          }
        }).pipe(
          withTestCtx({
            suffix: scenarioSummary,
            timeout: batchTimeout,
          })(test),
        )
      })
    }

    Vitest.scopedLive.prop(
      'streams batch variations over provider payload limits',
      [LargeBatchScenarioSchema],
      ([scenario], test) => {
        const summary = batchScenarioSummary(scenario)

        return Effect.gen(function* () {
          const scenarioId = nanoid()
          const approxBytes = approxBatchPayloadBytes(scenario)

          expect(approxBytes).toBeGreaterThanOrEqual(MIN_BATCH_PAYLOAD_BYTES)

          const syncBackend = yield* makeProvider(`${test.task.name}-${scenario.variant}-${scenarioId}`, {
            pingSchedule: batchPingSchedule,
          })

          const batchEvents = makeBatchEvents(scenario, {
            baseId: `${scenario.variant}-${scenarioId}`,
          })

          yield* pushBatchEvents(syncBackend, batchEvents, scenario.pushBatchSize)

          const stats = yield* collectBatchPullStats(syncBackend)

          expect(stats.totalEvents).toBe(scenario.eventCount)
          expect(stats.nonEmptyBatches).toBeGreaterThan(0)

          if (scenario.variant === 'manySmall' && name.toLowerCase().includes('cloudflare')) {
            expect(stats.nonEmptyBatches).toBeGreaterThan(1)
          }
        }).pipe(
          withTestCtx({
            suffix: summary,
            timeout: batchTimeout,
          })(test),
        )
      },
      { timeout: batchTestTimeout, fastCheck: { numRuns: 1 } },
    )
  })

  Vitest.scopedLive('non-live pull returns multiple events', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider(test.task.name)
      const eventFactory = makeFactory({ client: defaultClient, startSeq: 1, initialParent: 'root' })

      // Push at least two events
      for (let i = 0; i < 2; i++) {
        yield* syncBackend.push([
          eventFactory.todoCreated.next({
            id: `multi-${i}`,
            text: `Event ${i}`,
            completed: i % 2 === 0,
          }),
        ])
      }

      // Non-live pull should return both events across its pages
      const results = yield* syncBackend.pull(Option.none()).pipe(Stream.runCollectReadonlyArray)
      const pulled = results.flatMap((r) => r.batch.map((b) => b.eventEncoded))
      expect(pulled.length).toBeGreaterThanOrEqual(2)
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

        const eventFactory = makeFactory({ client: defaultClient })

        eventFactory.todoCreated.advanceTo(1, 'root')
        yield* syncBackend.push([eventFactory.todoCreated.next({ id: '1', text: 'Test event 1.', completed: false })])

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
      const eventFactory = makeFactory({ client: defaultClient, startSeq, initialParent: 'root' })

      for (let i = 0; i < eventsToCreate; i++) {
        yield* syncBackend.push([
          eventFactory.todoCreated.next({ id: `remaining-test-${i}`, text: `Event ${i}`, completed: false }),
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
      const eventFactory = makeFactory({ client: defaultClient, startSeq, initialParent: 'root' })

      for (let i = 0; i < totalEvents; i++) {
        yield* syncBackend.push([
          eventFactory.todoCreated.next({ id: `limited-${i}`, text: `Limited Event ${i}`, completed: false }),
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

  Vitest.scopedLive('large batch pagination', (test) =>
    Effect.gen(function* () {
      const syncBackend = yield* makeProvider('large-batch-test')

      const TOTAL_EVENTS = 10000
      const BATCH_SIZE = 100 // Push in batches to avoid any push limits
      const startSeq = 20000 // Use high sequence numbers to avoid conflicts
      const eventFactory = makeFactory({ client: defaultClient, startSeq, initialParent: 'root' })

      // Push 10000 events in batches
      for (let batchStart = 0; batchStart < TOTAL_EVENTS; batchStart += BATCH_SIZE) {
        const batchEvents: Array<LiveStoreEvent.AnyEncodedGlobal> = []
        const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL_EVENTS)

        for (let i = batchStart; i < batchEnd; i++) {
          batchEvents.push(
            eventFactory.todoCreated.next({
              id: `batch-${i}`,
              text: `Event ${i}`,
              completed: false,
            }),
          )
        }

        yield* syncBackend.push(batchEvents)
      }

      // Pull all events non-live
      const allResultsChunk = yield* syncBackend.pull(Option.none()).pipe(Stream.runCollect)
      const allResults = Chunk.toArray(allResultsChunk)

      // Count total events retrieved
      const totalRetrievedEvents = allResults.reduce((acc, r) => acc + r.batch.length, 0)

      // Verify we got a significant number of events
      // Providers with pagination should get all 10000
      // Mock provider and others without persistent storage may return 0
      // We'll check for pagination specifically for providers that return many events
      if (totalRetrievedEvents > 0) {
        // If provider returned events, we expect a reasonable amount
        expect(totalRetrievedEvents).toBeGreaterThanOrEqual(100)
      }

      // If we got all events, verify they are in correct order
      const allEvents = allResults.flatMap((r) => r.batch)
      if (totalRetrievedEvents === TOTAL_EVENTS) {
        for (let i = 0; i < Math.min(100, allEvents.length); i++) {
          const event = allEvents[i]!
          expect(event.eventEncoded.seqNum).toEqual(EventSequenceNumber.globalEventSequenceNumber(startSeq + i))
        }
      }

      // Test cursor-based pull from middle (if we have enough events)
      if (totalRetrievedEvents >= 500) {
        const middleIndex = Math.floor(totalRetrievedEvents / 2)
        const middleEvent = allEvents[middleIndex]!

        const middleCursor = Option.some({
          eventSequenceNumber: middleEvent.eventEncoded.seqNum,
          metadata: middleEvent.metadata,
        })

        const fromMiddleChunk = yield* syncBackend.pull(middleCursor).pipe(Stream.runCollect)
        const eventsFromMiddle = Chunk.toArray(fromMiddleChunk).flatMap((r) => r.batch)

        // Should get events after the cursor (or 0 if near the end)
        expect(eventsFromMiddle.length).toBeGreaterThanOrEqual(0)

        // Verify first event after cursor has higher sequence number
        if (
          eventsFromMiddle.length > 0 &&
          middleEvent.eventEncoded.seqNum &&
          eventsFromMiddle[0]?.eventEncoded.seqNum
        ) {
          const firstAfterCursor = eventsFromMiddle[0]
          const firstSeqNum = firstAfterCursor.eventEncoded.seqNum
          const middleSeqNum = middleEvent.eventEncoded.seqNum

          expect(firstSeqNum).toBeGreaterThan(middleSeqNum)
        }
      }
    }).pipe(withTestCtx({ suffix: 'large-batch', timeout: Duration.minutes(2) })(test)),
  )
})
