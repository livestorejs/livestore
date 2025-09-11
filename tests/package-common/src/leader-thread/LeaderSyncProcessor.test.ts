import type { SyncOptions } from '@livestore/common'
import {
  BackendIdMismatchError,
  InvalidPushError,
  type LeaderAheadError,
  type MockSyncBackend,
  makeMockSyncBackend,
  ServerAheadError,
  type SyncState,
  type UnexpectedError,
} from '@livestore/common'
import type { MakeLeaderThreadLayerParams } from '@livestore/common/leader-thread'
import { LeaderThreadCtx, makeLeaderThreadLayer, ShutdownChannel as Shutdown } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { type MakeNodeSqliteDb, sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { omitUndefineds } from '@livestore/utils'
import {
  Chunk,
  Context,
  Deferred,
  Effect,
  FetchHttpClient,
  Layer,
  Logger,
  LogLevel,
  Predicate,
  Queue,
  Schema,
  type Scope,
  Stream,
  WebChannel,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { events, schema, tables } from './fixture.ts'

/*
TODO:
- batch queued events which are about to be pushed
- rebase handling
- throughput metrics
- rebase thrashing tests
  - general idea: make rebase take 10ms but cause new pull events every 5ms
- benchmarks
  - 10.000 events
  - 100.000 events
- expose sync state: number of events left to pull + push
- make connected state settable
*/

const withTestCtx = (
  args: Partial<Pick<MakeLeaderThreadLayerParams, 'params' | 'testing'>> & {
    /** Warning: Setting `livePull` to `false` will lead to some less explored scenarios (e.g. only pulls once on boot) */
    syncOptions?: Partial<SyncOptions>
    captureShutdown?: boolean
  } = {},
) =>
  Vitest.makeWithTestCtx({
    makeLayer: () =>
      Layer.provideMerge(LeaderThreadCtxLive(args), PlatformNode.NodeFileSystem.layer).pipe(
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    forceOtel: true,
  })

Vitest.describe.concurrent('LeaderSyncProcessor', () => {
  Vitest.scopedLive('sync', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      yield* testContext.localPush(
        events.todoCreated({ id: '1', text: 't1' }),
        events.todoCreated({ id: '2', text: 't2' }),
      )

      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.takeUntil((_) => _.localHead.global === 2),
        Stream.runDrain,
      )

      const result = leaderThreadCtx.dbState.select(tables.todos.asSql().query)

      expect(result).toEqual([
        { id: '1', text: 't1', completed: 0, deletedAt: null },
        { id: '2', text: 't2', completed: 0, deletedAt: null },
      ])

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(2), Stream.runDrain)
    }).pipe(withTestCtx()(test)),
  )

  // TODO property based testing to test following cases:
  // push first, then pull + latency in between (need to adjust the backend id accordingly)
  // pull first, then push + latency in between

  // In this test we're simulating a client leader that is behind the backend
  Vitest.scopedLive('invalid push', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      yield* testContext.mockSyncBackend.disconnect

      yield* testContext.mockSyncBackend.advance(
        testContext
          .encodeLiveStoreEvent({
            ...events.todoCreated({ id: '1', text: 't1' }),
            seqNum: EventSequenceNumber.make({ global: 1, client: 0 }),
            parentSeqNum: EventSequenceNumber.ROOT,
          })
          .toGlobal(),
      )

      yield* testContext.localPush(events.todoCreated({ id: '2', text: 't2' }))

      yield* Effect.sleep(20).pipe(Effect.withSpan('@livestore/common-tests:sync:sleep'))

      const result = leaderThreadCtx.dbState.select(tables.todos.asSql().query)
      expect(result).toEqual([{ id: '2', text: 't2', completed: 0, deletedAt: null }])

      // This will cause a rebase given mismatch: local insert(id: '2') vs remote insert(id: '1')
      yield* testContext.mockSyncBackend.connect

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)

      const rebasedResult = leaderThreadCtx.dbState.select(tables.todos.asSql().query)
      expect(rebasedResult).toEqual([
        { id: '1', text: 't1', completed: 0, deletedAt: null },
        { id: '2', text: 't2', completed: 0, deletedAt: null },
      ])

      const queueResults = yield* Queue.takeAll(testContext.pullQueue).pipe(Effect.map(Chunk.toReadonlyArray))
      expect(queueResults[0]!.payload._tag).toEqual('upstream-advance')
      expect(queueResults[1]!.payload._tag).toEqual('upstream-rebase')
    }).pipe(withTestCtx()(test)),
  )

  Vitest.scopedLive('many local pushes', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      const numberOfPushes = 100

      yield* Effect.forEach(
        Array.from({ length: numberOfPushes }, (_, i) => i),
        (i) =>
          testContext.localPush(
            events.todoCreated({ id: `local-push-${i}`, text: `local-push-${i}`, completed: false }),
          ),
        { concurrency: 'unbounded' },
      ).pipe(Effect.withSpan(`@livestore/common-tests:sync:events(${numberOfPushes})`))

      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.takeUntil((_) => _.localHead.global === numberOfPushes),
        Stream.runDrain,
      )

      const result = leaderThreadCtx.dbState.select(tables.todos.asSql().query)
      expect(result.length).toEqual(numberOfPushes)

      const queueResults = yield* Queue.takeAll(testContext.pullQueue).pipe(Effect.map(Chunk.toReadonlyArray))
      expect(queueResults.every((result) => result.payload._tag === 'upstream-advance')).toBe(true)
    }).pipe(withTestCtx()(test)),
  )

  Vitest.scopedLive('concurrent pushes', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext

      for (let i = 0; i < 5; i++) {
        yield* testContext.mockSyncBackend
          .advance(
            testContext
              .encodeLiveStoreEvent({
                ...events.todoCreated({ id: `backend_${i}`, text: '', completed: false }),
                seqNum: EventSequenceNumber.make({ global: i + 1, client: 0 }),
                parentSeqNum: EventSequenceNumber.make({ global: i, client: 0 }),
              })
              .toGlobal(),
          )
          .pipe(Effect.fork)
      }

      for (let i = 0; i < 5; i++) {
        yield* testContext
          .localPush(events.todoCreated({ id: `local_${i}`, text: '', completed: false }))
          .pipe(Effect.tapCauseLogPretty, Effect.exit)
      }

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(2), Stream.runDrain)
    }).pipe(withTestCtx()(test)),
  )

  // Duplicate local push events could e.g. caused by multiple client sessions
  Vitest.scopedLive('handles duplicate local push events', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext

      for (let i = 0; i < 10; i++) {
        const event = {
          ...events.todoCreated({ id: `session_1_${i}`, text: '', completed: false }),
          seqNum: EventSequenceNumber.make({ global: i + 1, client: 0 }),
          parentSeqNum: EventSequenceNumber.make({ global: i, client: 0 }),
        }
        yield* testContext.localPush(event).pipe(Effect.repeatN(1), Effect.ignoreLogged)
      }

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(10), Stream.runDrain)
    }).pipe(
      withTestCtx({
        testing: { syncProcessor: { delays: { localPushProcessing: Effect.sleep(10) } } },
        params: { localPushBatchSize: 2 },
      })(test),
    ),
  )

  // TODO tests for
  // - aborting local pushes
  // - processHead works properly

  Vitest.scopedLive('simulate ServerAheadError push error', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext

      // Cause the next push to fail with ServerAheadError so the pushing fiber parks (Effect.never)
      yield* testContext.mockSyncBackend.failNextPushes(
        1,
        () =>
          new InvalidPushError({
            cause: new ServerAheadError({
              minimumExpectedNum: EventSequenceNumber.globalEventSequenceNumber(2),
              providedNum: EventSequenceNumber.globalEventSequenceNumber(1),
            }),
          }),
      )

      // Enqueue one local event which will attempt a push and hit the simulated error
      yield* testContext.localPush(events.todoCreated({ id: 'stall', text: 'stall' }))

      // Waiting a bit to make sure we've already attempted to push to the backend
      // TODO replace this sleep with a an API that allows us to wait until the push was processed by the sync backend
      yield* Effect.sleep(50)

      // Sync protocol requires that the sync backend emits a new pull chunk alongside the ServerAheadError
      yield* testContext.mockSyncBackend.advance(
        testContext
          .encodeLiveStoreEvent({
            ...events.todoCreated({ id: '1', text: 't1' }),
            seqNum: EventSequenceNumber.make({ global: 1, client: 0 }),
            parentSeqNum: EventSequenceNumber.ROOT,
          })
          .toGlobal(),
      )

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain, Effect.timeout(5000))
    }).pipe(withTestCtx()(test)),
  )
  // - test for filtering out local push queue items with an older rebase generation
  //   this can happen in a scenario like this
  //   1) local push events are queued (rebase generation 0) + queue is not yet processed (probably requires delay to simulate)
  //   2) pulling from backend -> causes rebase (rebase generation 1)
  //   3) new local push events are queued (rebase generation 1)
  //   4) queue is processed -> old local push events should be filtered out because they have an older rebase generation

  // Regression test for push fiber stalling when livePull=false and backend push errors occur
  Vitest.scopedLive('recovers from backend push errors without live pull', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      // Make next few pushes fail at the mock backend level
      yield* testContext.mockSyncBackend.failNextPushes(2)

      // Push a few local events; initial push attempts will fail
      yield* testContext.localPush(
        events.todoCreated({ id: 'p1', text: 'a' }),
        events.todoCreated({ id: 'p2', text: 'b' }),
        events.todoCreated({ id: 'p3', text: 'c' }),
        events.todoCreated({ id: 'p4', text: 'd' }),
      )

      // Expect all 4 to eventually be pushed to the backend (with timeout to catch stalls)
      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(4), Stream.runDrain, Effect.timeout(7000))

      // Verify they have been materialized locally as well
      const result = leaderThreadCtx.dbState.select(tables.todos.asSql().query)
      expect(result.length).toEqual(4)
    }).pipe(
      withTestCtx({ params: { backendPushBatchSize: 2 }, syncOptions: { livePull: false, onSyncError: 'ignore' } })(
        test,
      ),
    ),
  )

  // Should escalate and shutdown on BackendIdMismatchError when onSyncError='shutdown'
  Vitest.scopedLive('shutdowns on BackendIdMismatchError push', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext

      // Fail the next push due to backend id mismatch
      yield* testContext.mockSyncBackend.failNextPushes(1, () =>
        Effect.fail(new InvalidPushError({ cause: new BackendIdMismatchError({ expected: 'a', received: 'b' }) })),
      )

      // Trigger a local push
      yield* testContext.localPush(events.todoCreated({ id: 'mismatch', text: 'x' }))

      // Expect a shutdown message to be sent with InvalidPushError/BackendIdMismatchError
      const shutdownMsg = yield* testContext.shutdownDeferred.pipe(Effect.flip, Effect.timeout(3000))

      expect(shutdownMsg._tag).toEqual('InvalidPushError')
      // expect((shutdownMsg.cause as InvalidPushError).cause._tag).toEqual('BackendIdMismatchError')
    }).pipe(withTestCtx({ syncOptions: { onSyncError: 'shutdown', livePull: false }, captureShutdown: true })(test)),
  )
})

class TestContext extends Context.Tag('TestContext')<
  TestContext,
  {
    mockSyncBackend: MockSyncBackend
    shutdownDeferred: Deferred.Deferred<void, typeof Shutdown.All.Type>
    encodeLiveStoreEvent: (
      event: Omit<LiveStoreEvent.AnyDecoded, 'clientId' | 'sessionId'>,
    ) => LiveStoreEvent.EncodedWithMeta
    pullQueue: Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type }>
    /** Equivalent to the ClientSessionSyncProcessor calling `.push` on the LeaderThreadCtx */
    localPush: (
      ...events: LiveStoreEvent.PartialAnyDecoded[] | LiveStoreEvent.AnyDecoded[]
    ) => Effect.Effect<void, UnexpectedError | LeaderAheadError, Scope.Scope | LeaderThreadCtx>
  }
>() {}

const LeaderThreadCtxLive = ({
  syncProcessor,
  params,
  syncOptions,
  captureShutdown,
}: {
  syncProcessor?: NonNullable<MakeLeaderThreadLayerParams['testing']>['syncProcessor']
  params?: MakeLeaderThreadLayerParams['params']
  /** Optional overrides for sync options (e.g. custom backend, livePull flag) */
  syncOptions?: Partial<SyncOptions>
  captureShutdown?: boolean
}) =>
  Effect.gen(function* () {
    const mockSyncBackend = yield* makeMockSyncBackend()

    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
      Effect.withSpan('@livestore/adapter-node:leader-thread:loadSqlite3Wasm'),
    )

    const makeSqliteDb = (yield* sqliteDbFactory({ sqlite3 })) as MakeNodeSqliteDb

    const shutdownProxy = captureShutdown ? yield* WebChannel.queueChannelProxy({ schema: Shutdown.All }) : undefined

    const leaderContextLayer = makeLeaderThreadLayer({
      schema,
      storeId: 'test',
      clientId: 'test',
      syncPayload: undefined,
      makeSqliteDb,
      syncOptions: {
        backend: syncOptions?.backend ?? (() => mockSyncBackend.makeSyncBackend),
        ...omitUndefineds({
          livePull: syncOptions?.livePull,
          onSyncError: syncOptions?.onSyncError,
          initialSyncOptions: syncOptions?.initialSyncOptions,
        }),
      },
      dbState: yield* makeSqliteDb({ _tag: 'in-memory' }),
      dbEventlog: yield* makeSqliteDb({ _tag: 'in-memory' }),
      devtoolsOptions: { enabled: false },
      shutdownChannel: shutdownProxy?.webChannel ?? (yield* WebChannel.noopChannel<any, any>()),
      testing: {
        ...omitUndefineds({ syncProcessor }),
      },
      ...omitUndefineds({ params }),
    }).pipe(Layer.provide(FetchHttpClient.layer))

    const testContextLayer = Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx

      const encodeLiveStoreEvent = ({
        ...event
      }: Omit<typeof LiveStoreEvent.EncodedWithMeta.Encoded, 'clientId' | 'sessionId'>) =>
        new LiveStoreEvent.EncodedWithMeta({
          ...Schema.encodeUnknownSync(leaderThreadCtx.eventSchema)({
            ...event,
            clientId: leaderThreadCtx.clientId,
            sessionId: 'static-session-id',
          }),
        })

      const currentLiveStoreEventSequenceNumber = { current: EventSequenceNumber.ROOT }

      const pullQueue = yield* leaderThreadCtx.syncProcessor.pullQueue({
        cursor: EventSequenceNumber.ROOT,
      })

      const toEncodedLiveStoreEvent = (event: LiveStoreEvent.PartialAnyDecoded | LiveStoreEvent.AnyDecoded) => {
        if (Predicate.hasProperty(event, 'seqNum')) {
          return encodeLiveStoreEvent(event)
        }

        const nextNumPair = EventSequenceNumber.nextPair({
          seqNum: currentLiveStoreEventSequenceNumber.current,
          isClient: false,
        })
        currentLiveStoreEventSequenceNumber.current = nextNumPair.seqNum
        return encodeLiveStoreEvent({ ...event, ...nextNumPair })
      }

      const localPush = (...partialEvents: LiveStoreEvent.PartialAnyDecoded[]) =>
        leaderThreadCtx.syncProcessor.push(partialEvents.map((partialEvent) => toEncodedLiveStoreEvent(partialEvent)))

      const shutdownDeferred = yield* Deferred.make<void, typeof Shutdown.All.Type>()

      if (shutdownProxy !== undefined) {
        yield* shutdownProxy.sendQueue.pipe(
          Queue.take,
          Effect.flip,
          Effect.intoDeferred(shutdownDeferred),
          Effect.forkScoped,
        )
      }

      return Layer.succeed(TestContext, {
        mockSyncBackend,
        shutdownDeferred,
        encodeLiveStoreEvent,
        pullQueue,
        localPush,
      })
    }).pipe(Layer.unwrapScoped, Layer.provide(leaderContextLayer))

    return leaderContextLayer.pipe(Layer.merge(testContextLayer))
  }).pipe(Layer.unwrapScoped)
