import type { SyncOptions } from '@livestore/common'
import {
  BackendIdMismatchError,
  InvalidPushError,
  type LeaderAheadError,
  type MockSyncBackend,
  makeMockSyncBackend,
  ServerAheadError,
  type SyncBackend,
  type SyncState,
  type UnexpectedError,
} from '@livestore/common'
import type { MakeLeaderThreadLayerParams } from '@livestore/common/leader-thread'
import { LeaderThreadCtx, makeLeaderThreadLayer, ShutdownChannel as Shutdown } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { type MakeNodeSqliteDb, sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { omitUndefineds } from '@livestore/utils'
import {
  Chunk,
  Context,
  Deferred,
  Duration,
  Effect,
  FetchHttpClient,
  Layer,
  Logger,
  LogLevel,
  Queue,
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
    mockBackendOverride?: (mock: MockSyncBackend) => SyncBackend.SyncBackendConstructor
  } = {},
) =>
  Vitest.makeWithTestCtx({
    makeLayer: () =>
      Layer.provideMerge(LeaderThreadCtxLive(args), PlatformNode.NodeFileSystem.layer).pipe(
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
      ),
    forceOtel: true,
  })

const makeEventFactory = EventFactory.makeFactory(events)

Vitest.describe.concurrent('LeaderSyncProcessor', { timeout: 60000 }, () => {
  Vitest.scopedLive('sync', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      const eventFactory = testContext.eventFactory

      yield* testContext.pushEncoded(
        eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }),
        eventFactory.todoCreated.next({ id: '2', text: 't2', completed: false }),
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

  Vitest.scopedLive('local push old-gen items fail promptly with LeaderAheadError', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      const syncStateBefore = yield* leaderThreadCtx.syncProcessor.syncState.get

      // Create an event with a stale rebase generation to mimic a client that cached an outdated head.
      const baseEvent = testContext.eventFactory.todoCreated.next({
        id: 'local-old-gen',
        text: 'y',
        completed: false,
      })

      const staleSeq = EventSequenceNumber.make({
        global: (syncStateBefore.localHead.global + 1) as any,
        client: EventSequenceNumber.clientDefault,
        rebaseGeneration: syncStateBefore.localHead.rebaseGeneration - 1,
      })

      const staleParent = EventSequenceNumber.make({
        ...syncStateBefore.localHead,
        rebaseGeneration: syncStateBefore.localHead.rebaseGeneration - 1,
      })

      // The waitForProcessing flag ensures push waits on the deferred, so we observe the rejection path.
      const staleEvent = LiveStoreEvent.EncodedWithMeta.make({
        ...LiveStoreEvent.encodedFromGlobal(baseEvent),
        seqNum: staleSeq,
        parentSeqNum: staleParent,
      })

      const leaderAheadError = yield* leaderThreadCtx.syncProcessor
        .push([staleEvent], { waitForProcessing: true })
        .pipe(Effect.flip)

      expect(leaderAheadError._tag).toBe('LeaderAheadError')
      expect(leaderAheadError.minimumExpectedNum).toEqual(syncStateBefore.localHead)
      expect(leaderAheadError.providedNum).toEqual(staleSeq)
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

      const eventFactory = testContext.eventFactory
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
      })

      yield* testContext.mockSyncBackend.disconnect

      yield* testContext.mockSyncBackend.advance(
        backendFactory.todoCreated.next({ id: '1', text: 't1', completed: false }),
      )

      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: '2', text: 't2', completed: false }))

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
      const eventFactory = testContext.eventFactory

      const numberOfPushes = 100

      yield* Effect.forEach(
        Array.from({ length: numberOfPushes }, (_, i) => i),
        (i) =>
          testContext.pushEncoded(
            eventFactory.todoCreated.next({ id: `local-push-${i}`, text: `local-push-${i}`, completed: false }),
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
      const eventFactory = testContext.eventFactory
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
      })

      for (let i = 0; i < 5; i++) {
        yield* testContext.mockSyncBackend
          .advance(backendFactory.todoCreated.next({ id: `backend_${i}`, text: '', completed: false }))
          .pipe(Effect.fork)
      }

      for (let i = 0; i < 5; i++) {
        yield* testContext
          .pushEncoded(eventFactory.todoCreated.next({ id: `local_${i}`, text: '', completed: false }))
          .pipe(Effect.tapCauseLogPretty, Effect.exit)
      }

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(2), Stream.runDrain)
    }).pipe(withTestCtx()(test)),
  )

  // Duplicate local push events could e.g. caused by multiple client sessions
  Vitest.scopedLive('handles duplicate local push events', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory

      for (let i = 0; i < 10; i++) {
        const event = eventFactory.todoCreated.next({ id: `session_1_${i}`, text: '', completed: false })
        yield* testContext.pushEncoded(event).pipe(Effect.repeatN(1), Effect.ignoreLogged)
      }

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(10), Stream.runDrain)
    }).pipe(
      withTestCtx({
        testing: { syncProcessor: { delays: { localPushProcessing: Effect.sleep(10) } } },
        params: { localPushBatchSize: 2 },
      })(test),
    ),
  )

  /**
   * Session A pushes e1…e6 through the public `push` API while session B (same
   * client, different session) wakes with stale state and enqueues [e2, e7, e8]. The leader should
   * reject the batch with `LeaderAheadError`, forcing session B to rebase locally.
   */
  Vitest.scopedLive('leader push API rejects stale batch from secondary session', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext

      const sessionAFactory = makeEventFactory({
        client: EventFactory.clientIdentity('client-shared', 'session-A'),
        startSeq: 1,
        initialParent: 'root',
      })

      const sessionBFactory = makeEventFactory({
        client: EventFactory.clientIdentity('client-shared', 'session-B'),
        startSeq: 2,
        initialParent: 1,
      })

      const sessionAEvents = [
        sessionAFactory.todoCreated.next({ id: 'A-1', text: 'A-1', completed: false }),
        sessionAFactory.todoCreated.next({ id: 'A-2', text: 'A-2', completed: false }),
        sessionAFactory.todoCreated.next({ id: 'A-3', text: 'A-3', completed: false }),
        sessionAFactory.todoCreated.next({ id: 'A-4', text: 'A-4', completed: false }),
        sessionAFactory.todoCreated.next({ id: 'A-5', text: 'A-5', completed: false }),
        sessionAFactory.todoCreated.next({ id: 'A-6', text: 'A-6', completed: false }),
      ]

      // Session A floods the leader with six optimistic events (e1…e6)
      yield* testContext.pushEncoded(...sessionAEvents)

      const staleEventB = sessionBFactory.todoCreated.next({ id: 'B-stale', text: 'B-stale', completed: false })
      sessionBFactory.todoCreated.advanceTo(7, 6) // Make sure we rebase to e7
      const followUpB1 = sessionBFactory.todoCreated.next({ id: 'B-follow-7', text: 'B-follow-7', completed: false })
      const followUpB2 = sessionBFactory.todoCreated.next({ id: 'B-follow-8', text: 'B-follow-8', completed: false })

      // Session B resumes with a stale pending mutation followed by two fresh events
      const pushResult = yield* testContext
        .pushEncoded(staleEventB, followUpB1, followUpB2)
        .pipe(Effect.either, Effect.timeout(Duration.seconds(5)))

      expect(pushResult._tag).toBe('Left')
      if (pushResult._tag !== 'Left') {
        return
      }

      const error = pushResult.left
      expect(error._tag).toBe('LeaderAheadError')
      if (error._tag !== 'LeaderAheadError') {
        return
      }

      expect(EventSequenceNumber.toString(error.minimumExpectedNum)).toBe('e6')
      expect(EventSequenceNumber.toString(error.providedNum)).toBe('e2')
    }).pipe(withTestCtx()(test)),
  )

  // TODO tests for
  // - aborting local pushes
  // - processHead works properly

  Vitest.scopedLive('simulate ServerAheadError push error', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
      })

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
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: 'stall', text: 'stall', completed: false }))

      // Waiting a bit to make sure we've already attempted to push to the backend
      // TODO replace this sleep with a an API that allows us to wait until the push was processed by the sync backend
      yield* Effect.sleep(50)

      // Sync protocol requires that the sync backend emits a new pull chunk alongside the ServerAheadError
      yield* testContext.mockSyncBackend.advance(
        backendFactory.todoCreated.next({ id: '1', text: 't1', completed: false }),
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

  Vitest.scopedLive('accepts rebased client events when generation increases', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx

      const syncStateBefore = yield* leaderThreadCtx.syncProcessor.syncState.get
      const nextPair = EventSequenceNumber.nextPair({
        seqNum: syncStateBefore.localHead,
        isClient: true,
        rebaseGeneration: syncStateBefore.localHead.rebaseGeneration + 1,
      })

      const rebasedClientEvent = LiveStoreEvent.EncodedWithMeta.make({
        name: 'app_configSet',
        args: { id: 'session-a', value: { theme: 'dark' } },
        seqNum: nextPair.seqNum,
        parentSeqNum: nextPair.parentSeqNum,
        clientId: leaderThreadCtx.clientId,
        sessionId: 'session-a',
      })

      yield* leaderThreadCtx.syncProcessor.push([rebasedClientEvent])

      const pendingStateOption = yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.filter((state) => state.pending.some((event) => event.name === 'app_configSet')),
        Stream.take(1),
        Stream.runHead,
        Effect.timeout('1 seconds'),
      )

      expect(pendingStateOption._tag).toBe('Some')
      if (pendingStateOption._tag !== 'Some') {
        return
      }

      expect(pendingStateOption.value.pending.some((event) => event.name === 'app_configSet')).toBe(true)
    }).pipe(withTestCtx()(test)),
  )

  // Regression test for push fiber stalling when livePull=false and backend push errors occur
  Vitest.scopedLive('recovers from backend push errors without live pull', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory

      // Make next few pushes fail at the mock backend level
      yield* testContext.mockSyncBackend.failNextPushes(2)

      // Push a few local events; initial push attempts will fail
      yield* testContext.pushEncoded(
        eventFactory.todoCreated.next({ id: 'p1', text: 'a', completed: false }),
        eventFactory.todoCreated.next({ id: 'p2', text: 'b', completed: false }),
        eventFactory.todoCreated.next({ id: 'p3', text: 'c', completed: false }),
        eventFactory.todoCreated.next({ id: 'p4', text: 'd', completed: false }),
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
      const eventFactory = testContext.eventFactory

      // Fail the next push due to backend id mismatch
      yield* testContext.mockSyncBackend.failNextPushes(1, () =>
        Effect.fail(new InvalidPushError({ cause: new BackendIdMismatchError({ expected: 'a', received: 'b' }) })),
      )

      // Trigger a local push
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: 'mismatch', text: 'x', completed: false }))

      // Expect a shutdown message to be sent with InvalidPushError/BackendIdMismatchError
      const shutdownMsg = yield* testContext.shutdownDeferred.pipe(Effect.flip, Effect.timeout(3000))

      expect(shutdownMsg._tag).toEqual('InvalidPushError')
      // expect((shutdownMsg.cause as InvalidPushError).cause._tag).toEqual('BackendIdMismatchError')
    }).pipe(withTestCtx({ syncOptions: { onSyncError: 'shutdown', livePull: false }, captureShutdown: true })(test)),
  )
})

type LeaderEventFactory = ReturnType<typeof makeEventFactory>

class TestContext extends Context.Tag('TestContext')<
  TestContext,
  {
    mockSyncBackend: MockSyncBackend
    shutdownDeferred: Deferred.Deferred<void, typeof Shutdown.All.Type>
    pullQueue: Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type }>
    eventFactory: LeaderEventFactory
    /** Equivalent to the ClientSessionSyncProcessor calling `.push` on the LeaderThreadCtx */
    pushEncoded: (
      ...events: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>
    ) => Effect.Effect<void, UnexpectedError | LeaderAheadError, Scope.Scope | LeaderThreadCtx>
  }
>() {}

const LeaderThreadCtxLive = ({
  syncProcessor,
  params,
  syncOptions,
  captureShutdown,
  mockBackendOverride,
}: {
  syncProcessor?: NonNullable<MakeLeaderThreadLayerParams['testing']>['syncProcessor']
  params?: MakeLeaderThreadLayerParams['params']
  /** Optional overrides for sync options (e.g. custom backend, livePull flag) */
  syncOptions?: Partial<SyncOptions>
  captureShutdown?: boolean
  mockBackendOverride?: (mock: MockSyncBackend) => SyncBackend.SyncBackendConstructor
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
        backend:
          mockBackendOverride?.(mockSyncBackend) ?? syncOptions?.backend ?? (() => mockSyncBackend.makeSyncBackend),
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

      const eventFactory = makeEventFactory({
        client: EventFactory.clientIdentity(leaderThreadCtx.clientId, 'static-session-id'),
      })

      const toEncodedWithMeta = (event: LiveStoreEvent.AnyEncodedGlobal) =>
        new LiveStoreEvent.EncodedWithMeta({
          ...LiveStoreEvent.encodedFromGlobal(event),
        })

      const pushEncoded = (...events: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) =>
        leaderThreadCtx.syncProcessor.push(events.map((event) => toEncodedWithMeta(event)))

      const pullQueue = yield* leaderThreadCtx.syncProcessor.pullQueue({
        cursor: EventSequenceNumber.ROOT,
      })

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
        pullQueue,
        eventFactory,
        pushEncoded,
      })
    }).pipe(Layer.unwrapScoped, Layer.provide(leaderContextLayer))

    return leaderContextLayer.pipe(Layer.merge(testContextLayer))
  }).pipe(Layer.unwrapScoped)
