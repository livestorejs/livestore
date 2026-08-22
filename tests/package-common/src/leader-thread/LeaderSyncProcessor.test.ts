import { assert, expect } from 'vitest'

import {
  BackendIdMismatchError,
  IsOfflineError,
  type IntentionalShutdownCause,
  type MockSyncBackend,
  type MockSyncBackendOptions,
  makeMockSyncBackend,
  NonContiguousBatchError,
  type RejectedPushError,
  ServerAheadError,
  StateHead,
  StaleRebaseGenerationError,
  type SyncBackend,
  type SyncOptions,
  type SyncState,
  UnknownError,
} from '@livestore/common'
import type { MakeLeaderThreadLayerParams } from '@livestore/common/leader-thread'
import { LeaderThreadCtx, makeLeaderThreadLayer, ShutdownChannel as Shutdown } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent, SystemTables } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { omitUndefineds } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Context,
  Deferred,
  Duration,
  Effect,
  FetchHttpClient,
  Fiber,
  Layer,
  Queue,
  References,
  Result,
  type Scope,
  Stream,
  TestClock,
  WebChannel,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

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
    mockBackendOptions?: MockSyncBackendOptions
    seedMockBackend?: (mockBackend: MockSyncBackend) => Effect.Effect<void>
    mockBackendOverride?: (mock: MockSyncBackend) => SyncBackend.SyncBackendConstructor
    coordinatePullApplication?: boolean
    failCoordinatedPullApplication?: boolean
  } = {},
) =>
  Vitest.makeWithTestCtx({
    makeLayer: () =>
      Layer.provideMerge(
        LeaderThreadCtxLive({ ...args, syncProcessor: args.testing?.syncProcessor }),
        PlatformNode.NodeFileSystem.layer,
      ).pipe(Layer.provide(Layer.succeed(References.MinimumLogLevel, 'Debug'))),
    forceOtel: true,
  })

const makeEventFactory = EventFactory.makeFactory(events)

const seedPaginatedBackendTodos = (mockBackend: MockSyncBackend) => {
  const backendFactory = makeEventFactory({
    client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
  })

  return mockBackend.advance(
    backendFactory.todoCreated.next({ id: 'backend-1', text: 'b1', completed: false }),
    backendFactory.todoCreated.next({ id: 'backend-2', text: 'b2', completed: false }),
    backendFactory.todoCreated.next({ id: 'backend-3', text: 'b3', completed: false }),
  )
}

/** Verifies: LS.SYS.SYNC.PROC-R01, LS.SYS.SYNC.PROC-R02, LS.SYS.SYNC.PROC-R04, LS.SYS.SYNC.SS-R06, LS.SYS.SYNC-R03, LS.SYS.RT-R10 */
Vitest.describe.concurrent('LeaderSyncProcessor', { timeout: 60000 }, () => {
  Vitest.live('sync', (test) =>
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
      const syncState = yield* leaderThreadCtx.syncProcessor.syncState.get

      expect(result).toEqual([
        { id: '1', text: 't1', completed: 0, deletedAt: null },
        { id: '2', text: 't2', completed: 0, deletedAt: null },
      ])
      expect(yield* StateHead.make({ dbState: leaderThreadCtx.dbState }).get).toEqual(syncState.localHead)

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(2), Stream.runDrain)
    }).pipe(withTestCtx()(test)),
  )

  Vitest.live('retains leader materialization metadata for pending local events', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext
      const sourceSessionChangeset = Uint8Array.from([255])

      yield* testContext.mockSyncBackend.disconnect

      const localEvent = new LiveStoreEvent.Client.EncodedWithMeta({
        ...LiveStoreEvent.Global.toClientEncoded(
          testContext.eventFactory.todoCreated.next({ id: 'local', text: 'local', completed: false }),
        ),
      })
      localEvent.meta.sessionChangeset = {
        _tag: 'sessionChangeset',
        data: sourceSessionChangeset,
        debug: undefined,
      }

      yield* leaderThreadCtx.syncProcessor.push([localEvent])

      const downstreamItem = yield* Queue.take(testContext.pullQueue)
      assert(downstreamItem.payload._tag === 'upstream-advance')

      const retainedEvent = (yield* leaderThreadCtx.syncProcessor.syncState.get).pending[0]!
      const publishedEvent = downstreamItem.payload.newEvents[0]!
      assert(retainedEvent.meta.sessionChangeset._tag === 'sessionChangeset')
      assert(publishedEvent.meta.sessionChangeset._tag === 'sessionChangeset')

      expect([...retainedEvent.meta.sessionChangeset.data]).toEqual([...publishedEvent.meta.sessionChangeset.data])
      expect([...retainedEvent.meta.sessionChangeset.data]).not.toEqual([...sourceSessionChangeset])
      expect(retainedEvent.meta.materializerHashLeader).toEqual(publishedEvent.meta.materializerHashLeader)
    }).pipe(withTestCtx()(test)),
  )

  Vitest.live('non-live paginated pull does not stall local pushes', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      const pulledStateOption = yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.filter((state) => state.localHead.global === 3),
        Stream.take(1),
        Stream.runHead,
        Effect.timeout('5 seconds'),
      )

      expect(pulledStateOption._tag).toBe('Some')
      if (pulledStateOption._tag !== 'Some') {
        return
      }

      const syncState = yield* leaderThreadCtx.syncProcessor.syncState.get
      const nextPair = EventSequenceNumber.Client.nextPair({
        seqNum: syncState.localHead,
        isClientOnly: false,
      })

      const localEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...LiveStoreEvent.Global.toClientEncoded(
          testContext.eventFactory.todoCreated.next({ id: 'local-after-pull', text: 'local', completed: false }),
        ),
        seqNum: nextPair.seqNum,
        parentSeqNum: nextPair.parentSeqNum,
      })

      yield* leaderThreadCtx.syncProcessor.push([localEvent])

      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain, Effect.timeout(5000))

      const rows = leaderThreadCtx.dbState.select<{ id: string }>(tables.todos.asSql().query)
      expect(rows.map((row) => row.id).toSorted()).toEqual(['backend-1', 'backend-2', 'backend-3', 'local-after-pull'])
    }).pipe(
      withTestCtx({
        syncOptions: { livePull: false, onSyncError: 'ignore' },
        mockBackendOptions: { nonLiveChunkSize: 1 },
        seedMockBackend: seedPaginatedBackendTodos,
      })(test),
    ),
  )

  Vitest.live('mid-pagination pull failure releases local push mutex', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      const syncStateBeforeWait = yield* leaderThreadCtx.syncProcessor.syncState.get
      if (syncStateBeforeWait.localHead.global < 1) {
        const firstPageApplied = yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
          Stream.filter((state) => state.localHead.global === 1),
          Stream.take(1),
          Stream.runHead,
          Effect.timeout('5 seconds'),
        )

        expect(firstPageApplied._tag).toBe('Some')
        if (firstPageApplied._tag !== 'Some') {
          return
        }
      }

      const syncState = yield* leaderThreadCtx.syncProcessor.syncState.get
      const nextPair = EventSequenceNumber.Client.nextPair({
        seqNum: syncState.localHead,
        isClientOnly: false,
      })

      const localEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...LiveStoreEvent.Global.toClientEncoded(
          testContext.eventFactory.todoCreated.next({
            id: 'local-after-pull-failure',
            text: 'local',
            completed: false,
          }),
        ),
        seqNum: nextPair.seqNum,
        parentSeqNum: nextPair.parentSeqNum,
      })

      yield* leaderThreadCtx.syncProcessor.push([localEvent])

      const rows = leaderThreadCtx.dbState.select<{ id: string }>(tables.todos.asSql().query)
      expect(rows.map((row) => row.id).toSorted()).toEqual(['backend-1', 'local-after-pull-failure'])
    }).pipe(
      withTestCtx({
        syncOptions: { livePull: false, onSyncError: 'ignore' },
        mockBackendOptions: { nonLiveChunkSize: 1 },
        seedMockBackend: seedPaginatedBackendTodos,
        mockBackendOverride: (mockBackend) => () =>
          Effect.gen(function* () {
            const syncBackend = yield* mockBackend.makeSyncBackend
            return {
              ...syncBackend,
              pull: (cursor, pullOptions) =>
                Stream.concat(
                  syncBackend.pull(cursor, pullOptions).pipe(Stream.take(1)),
                  Stream.fromEffect(
                    Effect.fail(new UnknownError({ cause: new Error('Simulated mid-pagination pull failure') })),
                  ),
                ),
            }
          }),
      })(test),
    ),
  )

  Vitest.live('mid-pagination pull interruption releases local push mutex', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext

      const syncStateBeforeWait = yield* leaderThreadCtx.syncProcessor.syncState.get
      if (syncStateBeforeWait.localHead.global < 1) {
        const firstPageApplied = yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
          Stream.filter((state) => state.localHead.global === 1),
          Stream.take(1),
          Stream.runHead,
          Effect.timeout('5 seconds'),
        )

        expect(firstPageApplied._tag).toBe('Some')
        if (firstPageApplied._tag !== 'Some') {
          return
        }
      }

      const syncState = yield* leaderThreadCtx.syncProcessor.syncState.get
      const nextPair = EventSequenceNumber.Client.nextPair({
        seqNum: syncState.localHead,
        isClientOnly: false,
      })

      const localEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...LiveStoreEvent.Global.toClientEncoded(
          testContext.eventFactory.todoCreated.next({
            id: 'local-after-pull-interrupt',
            text: 'local',
            completed: false,
          }),
        ),
        seqNum: nextPair.seqNum,
        parentSeqNum: nextPair.parentSeqNum,
      })

      yield* leaderThreadCtx.syncProcessor.push([localEvent])

      const rows = leaderThreadCtx.dbState.select<{ id: string }>(tables.todos.asSql().query)
      expect(rows.map((row) => row.id).toSorted()).toEqual(['backend-1', 'local-after-pull-interrupt'])
    }).pipe(
      withTestCtx({
        syncOptions: { livePull: false, onSyncError: 'ignore' },
        mockBackendOptions: { nonLiveChunkSize: 1 },
        seedMockBackend: seedPaginatedBackendTodos,
        mockBackendOverride: (mockBackend) => () =>
          Effect.gen(function* () {
            const syncBackend = yield* mockBackend.makeSyncBackend
            return {
              ...syncBackend,
              pull: (cursor, pullOptions) =>
                Stream.concat(
                  syncBackend.pull(cursor, pullOptions).pipe(Stream.take(1)),
                  Stream.fromEffect(Effect.interrupt),
                ),
            }
          }),
      })(test),
    ),
  )

  Vitest.live('local push old-gen items fail promptly with StaleRebaseGenerationError', (test) =>
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

      const staleSeq = EventSequenceNumber.Client.Composite.make({
        global: (syncStateBefore.localHead.global + 1) as any,
        client: EventSequenceNumber.Client.DEFAULT,
        rebaseGeneration: syncStateBefore.localHead.rebaseGeneration - 1,
      })

      const staleParent = EventSequenceNumber.Client.Composite.make({
        ...syncStateBefore.localHead,
        rebaseGeneration: syncStateBefore.localHead.rebaseGeneration - 1,
      })

      // push waits on the deferred, so we observe the rejection path.
      const staleEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...LiveStoreEvent.Global.toClientEncoded(baseEvent),
        seqNum: staleSeq,
        parentSeqNum: staleParent,
      })

      const error = yield* leaderThreadCtx.syncProcessor.push([staleEvent]).pipe(Effect.flip)

      expect(error._tag).toBe('StaleRebaseGenerationError')
      assert(error instanceof StaleRebaseGenerationError)

      expect(error.currentRebaseGeneration).toBe(syncStateBefore.localHead.rebaseGeneration)
      expect(error.providedRebaseGeneration).toBe(staleSeq.rebaseGeneration)
    }).pipe(withTestCtx()(test)),
  )

  // TODO property based testing to test following cases:
  // push first, then pull + latency in between (need to adjust the backend id accordingly)
  // pull first, then push + latency in between

  // In this test we're simulating a client leader that is behind the backend
  Vitest.live('invalid push', (test) =>
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

      const syncState = yield* leaderThreadCtx.syncProcessor.syncState.get
      expect(yield* StateHead.make({ dbState: leaderThreadCtx.dbState }).get).toEqual(syncState.localHead)

      const queueResults = yield* Queue.clear(testContext.pullQueue)
      expect(queueResults[0]!.payload._tag).toEqual('upstream-advance')
      expect(queueResults[1]!.payload._tag).toEqual('upstream-rebase')
    }).pipe(withTestCtx()(test)),
  )

  Vitest.live('many local pushes', (test) =>
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

      const queueResults = yield* Queue.clear(testContext.pullQueue)
      expect(queueResults.every((result) => result.payload._tag === 'upstream-advance')).toBe(true)
    }).pipe(withTestCtx()(test)),
  )

  Vitest.live('concurrent pushes', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
      })

      for (let i = 0; i < 5; i++) {
        yield* testContext.mockSyncBackend
          .advance(backendFactory.todoCreated.next({ id: `backend_${i}`, text: '', completed: false }))
          .pipe(Effect.forkChild)
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
  Vitest.live('handles duplicate local push events', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory

      for (let i = 0; i < 10; i++) {
        const event = eventFactory.todoCreated.next({ id: `session_1_${i}`, text: '', completed: false })
        yield* testContext.pushEncoded(event).pipe(Effect.repeat({ times: 1 }), Effect.ignore)
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
  Vitest.live('leader push API rejects stale batch from secondary session', (test) =>
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
        .pipe(Effect.result, Effect.timeout(Duration.seconds(5)))

      expect(Result.isFailure(pushResult)).toBe(true)
      if (Result.isSuccess(pushResult) === true) {
        return
      }

      const error = pushResult.failure
      expect(error._tag).toBe('LeaderAheadError')
      if (error._tag !== 'LeaderAheadError') {
        return
      }

      expect(EventSequenceNumber.Client.toString(error.minimumExpectedNum)).toBe('e6')
      expect(EventSequenceNumber.Client.toString(error.providedNum)).toBe('e2')
    }).pipe(withTestCtx()(test)),
  )

  Vitest.live('leader push API rejects a batch that skips its pending prefix', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const skippedPrefixFactory = makeEventFactory({
        client: EventFactory.clientIdentity('client-skipped-prefix', 'session-skipped-prefix'),
        startSeq: 2,
        initialParent: 1,
      })

      const eventAfterMissingPrefix = skippedPrefixFactory.todoCreated.next({
        id: 'after-missing-prefix',
        text: 'after-missing-prefix',
        completed: false,
      })
      const result = yield* testContext.pushEncoded(eventAfterMissingPrefix).pipe(Effect.result)

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isSuccess(result) === true) return

      expect(result.failure).toBeInstanceOf(NonContiguousBatchError)
      expect(result.failure._tag).toBe('NonContiguousBatchError')
      if (result.failure._tag !== 'NonContiguousBatchError') return

      expect(EventSequenceNumber.Client.toString(result.failure.expectedSeqNum)).toBe('e1')
      expect(EventSequenceNumber.Client.toString(result.failure.providedSeqNum)).toBe('e2')
      expect(result.failure.violationIndex).toBe(0)
    }).pipe(withTestCtx()(test)),
  )

  Vitest.live('releases rejected queue reservations before admitting a rebased session retry', (test) => {
    const localProcessingStarted = Deferred.makeUnsafe<void>()
    const allowLocalProcessing = Deferred.makeUnsafe<void>()
    const localPushAdmitted = Deferred.makeUnsafe<void>()

    return Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext
      const queuedFactory = makeEventFactory({
        client: EventFactory.clientIdentity('shared-client', 'queued-session'),
        startSeq: 1,
        initialParent: 'root',
      })
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('remote-client', 'remote-session'),
        startSeq: 1,
        initialParent: 'root',
      })

      yield* Deferred.await(localProcessingStarted)

      const queuedPush = yield* testContext
        .pushEncoded(
          ...Array.from({ length: 6 }, (_, index) =>
            queuedFactory.todoCreated.next({ id: `queued-${index}`, text: `queued-${index}`, completed: false }),
          ),
        )
        .pipe(Effect.result, Effect.forkChild)
      yield* Deferred.await(localPushAdmitted)

      // Advance the authoritative head while e1…e6 are reserved but not yet processed.
      yield* testContext.mockSyncBackend.advance(
        backendFactory.todoCreated.next({ id: 'remote-1', text: 'remote-1', completed: false }),
      )
      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.filter((state) => state.upstreamHead.global === 1),
        Stream.runFirstUnsafe,
      )

      yield* Deferred.succeed(allowLocalProcessing, undefined)
      const queuedResult = yield* Fiber.join(queuedPush)
      expect(Result.isFailure(queuedResult)).toBe(true)

      const retryBase = backendFactory.todoCreated.next({ id: 'retry-2', text: 'retry-2', completed: false })
      const retryPair = EventSequenceNumber.Client.nextPair({
        seqNum: EventSequenceNumber.Client.fromString('e1r1'),
        isClientOnly: false,
        rebaseGeneration: 1,
      })
      const rebasedRetry = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...LiveStoreEvent.Global.toClientEncoded(retryBase),
        ...retryPair,
        clientId: 'shared-client',
        sessionId: 'retry-session',
      })

      yield* leaderThreadCtx.syncProcessor.push([rebasedRetry])
      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain, Effect.timeout(5000))
    }).pipe(
      withTestCtx({
        mockBackendOptions: { startConnected: true },
        testing: {
          syncProcessor: {
            delays: {
              localPushProcessing: Effect.gen(function* () {
                yield* Deferred.succeed(localProcessingStarted, undefined)
                yield* Deferred.await(allowLocalProcessing)
              }),
            },
            hooks: {
              localPushAdmitted: () => Deferred.succeed(localPushAdmitted, undefined),
            },
          },
        },
      })(test),
    )
  })

  // TODO tests for
  // - aborting local pushes
  // - processHead works properly

  Vitest.live('actively catches up after an accepted push loses its pull publication', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
        startSeq: 2,
        initialParent: 1,
      })

      const initialPullCursor = yield* testContext.mockSyncBackend.pullRequests.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(initialPullCursor).toEqual(EventSequenceNumber.Client.ROOT.global)

      // Fault point 1: the backend accepts and persists A1, but its active pull never sees A1.
      yield* testContext.mockSyncBackend.dropNextPushPublications(1)
      const localA1 = eventFactory.todoCreated.next({ id: 'local-a1', text: 'local-a1', completed: false })
      yield* testContext.pushEncoded(localA1)

      const firstPushAttempt = yield* testContext.mockSyncBackend.pushAttempts.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(firstPushAttempt).toEqual([localA1])
      expect(yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.runFirstUnsafe, Effect.timeout(5000))).toEqual(
        localA1,
      )

      // Fault point 2: another client advances the backend to B2 without waking the stale pull.
      const remoteB2 = backendFactory.todoCreated.next({ id: 'remote-b2', text: 'remote-b2', completed: false })
      yield* testContext.mockSyncBackend.advanceWithoutPublication(remoteB2)

      // A2 still chains from A1. The mock now derives ServerAheadError naturally from backend head B2.
      const localA2 = eventFactory.todoCreated.next({ id: 'local-a2', text: 'local-a2', completed: false })
      yield* testContext.pushEncoded(localA2)
      const stalePushAttempt = yield* testContext.mockSyncBackend.pushAttempts.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(stalePushAttempt).toEqual([localA2])

      // ServerAhead actively replaces pull from the still-persisted root cursor. The fresh
      // generation snapshots A1+B2, confirms A1, rebases A2 to e3, and resumes pushing.
      const catchUpCursor = yield* testContext.mockSyncBackend.pullRequests.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(catchUpCursor).toEqual(EventSequenceNumber.Client.ROOT.global)

      const rebasedA2 = yield* testContext.mockSyncBackend.pushedEvents.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(rebasedA2.seqNum).toEqual(EventSequenceNumber.Global.make(3))
      expect(rebasedA2.args).toEqual(localA2.args)

      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.filter((state) => state.upstreamHead.global === 3 && state.pending.length === 0),
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )

      const storedEvents = yield* testContext.mockSyncBackend.storedEvents
      expect(storedEvents.map(({ seqNum, args }) => ({ seqNum, args }))).toEqual([
        { seqNum: EventSequenceNumber.Global.make(1), args: localA1.args },
        { seqNum: EventSequenceNumber.Global.make(2), args: remoteB2.args },
        { seqNum: EventSequenceNumber.Global.make(3), args: localA2.args },
      ])
      expect(yield* testContext.mockSyncBackend.activePulls.current).toEqual(1)
      expect(yield* testContext.mockSyncBackend.activePulls.maximum).toEqual(1)

      const rows = leaderThreadCtx.dbState.select<{ id: string }>(tables.todos.asSql().query)
      expect(rows.map(({ id }) => id).toSorted()).toEqual(['local-a1', 'local-a2', 'remote-b2'])
    }).pipe(withTestCtx({ mockBackendOptions: { startConnected: true } })(test)),
  )

  Vitest.live('restarts a completed finite pull after ServerAhead', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
        startSeq: 2,
        initialParent: 1,
      })

      const completedInitialCursor = yield* testContext.mockSyncBackend.completedPulls.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(completedInitialCursor).toEqual(EventSequenceNumber.Client.ROOT.global)
      expect(yield* testContext.mockSyncBackend.pullRequests.pipe(Stream.runFirstUnsafe, Effect.timeout(5000))).toEqual(
        EventSequenceNumber.Client.ROOT.global,
      )

      yield* testContext.mockSyncBackend.dropNextPushPublications(1)
      const localA1 = eventFactory.todoCreated.next({ id: 'finite-a1', text: 'finite-a1', completed: false })
      yield* testContext.pushEncoded(localA1)
      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.runFirstUnsafe, Effect.timeout(5000))

      const remoteB2 = backendFactory.todoCreated.next({ id: 'finite-b2', text: 'finite-b2', completed: false })
      yield* testContext.mockSyncBackend.advanceWithoutPublication(remoteB2)

      const localA2 = eventFactory.todoCreated.next({ id: 'finite-a2', text: 'finite-a2', completed: false })
      yield* testContext.pushEncoded(localA2)

      const catchUpCursor = yield* testContext.mockSyncBackend.pullRequests.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(catchUpCursor).toEqual(EventSequenceNumber.Client.ROOT.global)

      const rebasedA2 = yield* testContext.mockSyncBackend.pushedEvents.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(rebasedA2.seqNum).toEqual(EventSequenceNumber.Global.make(3))
      expect(rebasedA2.args).toEqual(localA2.args)

      const syncState = yield* leaderThreadCtx.syncProcessor.syncState.get
      expect(syncState.upstreamHead.global).toEqual(2)
      expect(syncState.pending.map((event) => event.args)).toEqual([localA2.args])

      expect(yield* testContext.mockSyncBackend.pullRequestCount).toEqual(2)
      expect((yield* testContext.mockSyncBackend.storedEvents).map((event) => event.args)).toEqual([
        localA1.args,
        remoteB2.args,
        localA2.args,
      ])
    }).pipe(withTestCtx({ mockBackendOptions: { startConnected: true }, syncOptions: { livePull: false } })(test)),
  )

  Vitest.live('finishes canonical pull application before replacing its generation', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
      })

      const pullApplicationControl = testContext.pullApplicationControl
      assert(pullApplicationControl !== undefined, 'pull application controls were not configured')

      expect(yield* testContext.mockSyncBackend.pullRequests.pipe(Stream.runFirstUnsafe, Effect.timeout(5000))).toEqual(
        EventSequenceNumber.Client.ROOT.global,
      )

      // Keep the successful rebased push from publishing into the generation being retired;
      // this test isolates the retirement/application boundary from a second confirmation chunk.
      yield* testContext.mockSyncBackend.dropNextPushPublications(1)

      const localA1 = eventFactory.todoCreated.next({ id: 'fenced-local', text: 'local', completed: false })
      yield* testContext.pushEncoded(localA1)
      yield* Deferred.await(pullApplicationControl.pushWaiting).pipe(Effect.timeout(5000))

      const remoteB1 = backendFactory.todoCreated.next({ id: 'fenced-remote', text: 'remote', completed: false })
      yield* testContext.mockSyncBackend.advance(remoteB1)
      yield* Deferred.await(pullApplicationControl.cursorAdvanced).pipe(Effect.timeout(5000))
      yield* Deferred.await(pullApplicationControl.restartRequested).pipe(Effect.timeout(5000))

      // Retirement is waiting outside the application fence; no replacement is active yet.
      expect(yield* testContext.mockSyncBackend.pullRequestCount).toEqual(1)
      expect(yield* testContext.mockSyncBackend.activePulls.current).toEqual(1)

      yield* Deferred.succeed(pullApplicationControl.allowApplication, undefined)

      const replacementCursor = yield* testContext.mockSyncBackend.pullRequests.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(replacementCursor).toEqual(EventSequenceNumber.Global.make(1))

      const rebasedLocal = yield* testContext.mockSyncBackend.pushedEvents.pipe(
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )
      expect(rebasedLocal.seqNum).toEqual(EventSequenceNumber.Global.make(2))
      expect(rebasedLocal.args).toEqual(localA1.args)

      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.filter((state) => state.upstreamHead.global === 2 && state.pending.length === 0),
        Stream.runFirstUnsafe,
        Effect.timeout(5000),
      )

      expect(yield* testContext.mockSyncBackend.activePulls.maximum).toEqual(1)
      expect((yield* testContext.mockSyncBackend.storedEvents).map((event) => event.args)).toEqual([
        remoteB1.args,
        localA1.args,
      ])
      expect(
        leaderThreadCtx.dbState
          .select<{ id: string }>(tables.todos.asSql().query)
          .map(({ id }) => id)
          .toSorted(),
      ).toEqual(['fenced-local', 'fenced-remote'])
    }).pipe(
      withTestCtx({
        mockBackendOptions: { startConnected: true },
        coordinatePullApplication: true,
      })(test),
    ),
  )

  Vitest.live('preserves a terminal canonical pull failure instead of replacing its generation', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const backendFactory = makeEventFactory({
        client: EventFactory.clientIdentity('mock-backend', 'static-session-id'),
      })
      const pullApplicationControl = testContext.pullApplicationControl
      assert(pullApplicationControl !== undefined, 'pull application controls were not configured')

      expect(yield* testContext.mockSyncBackend.pullRequests.pipe(Stream.runFirstUnsafe, Effect.timeout(5000))).toEqual(
        EventSequenceNumber.Client.ROOT.global,
      )

      const localA1 = testContext.eventFactory.todoCreated.next({
        id: 'failed-application-local',
        text: 'local',
        completed: false,
      })
      yield* testContext.pushEncoded(localA1)
      yield* Deferred.await(pullApplicationControl.pushWaiting).pipe(Effect.timeout(5000))

      const remoteB1 = backendFactory.todoCreated.next({
        id: 'failed-application-remote',
        text: 'remote',
        completed: false,
      })
      yield* testContext.mockSyncBackend.advance(remoteB1)
      yield* Deferred.await(pullApplicationControl.cursorAdvanced).pipe(Effect.timeout(5000))
      yield* Deferred.await(pullApplicationControl.restartRequested).pipe(Effect.timeout(5000))

      expect(yield* testContext.mockSyncBackend.pullRequestCount).toEqual(1)
      yield* Deferred.succeed(pullApplicationControl.allowApplication, undefined)

      const shutdownError = yield* Deferred.await(testContext.shutdownDeferred).pipe(Effect.flip, Effect.timeout(5000))
      expect(shutdownError._tag).toEqual('UnknownError')
      expect(yield* testContext.mockSyncBackend.pullRequestCount).toEqual(1)
      expect(yield* testContext.mockSyncBackend.activePulls.current).toEqual(0)
    }).pipe(
      withTestCtx({
        mockBackendOptions: { startConnected: true },
        syncOptions: { onSyncError: 'shutdown' },
        coordinatePullApplication: true,
        failCoordinatedPullApplication: true,
        captureShutdown: true,
      })(test),
    ),
  )

  // - test for filtering out local push queue items with an older rebase generation
  //   this can happen in a scenario like this
  //   1) local push events are queued (rebase generation 0) + queue is not yet processed (probably requires delay to simulate)
  //   2) pulling from backend -> causes rebase (rebase generation 1)
  //   3) new local push events are queued (rebase generation 1)
  //   4) queue is processed -> old local push events should be filtered out because they have an older rebase generation

  Vitest.live('accepts rebased client events when generation increases', (test) =>
    Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx

      const syncStateBefore = yield* leaderThreadCtx.syncProcessor.syncState.get
      const nextPair = EventSequenceNumber.Client.nextPair({
        seqNum: syncStateBefore.localHead,
        isClientOnly: true,
        rebaseGeneration: syncStateBefore.localHead.rebaseGeneration + 1,
      })

      const rebasedClientEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
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

  Vitest.live('does not retry an UnknownError from backend push', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory

      yield* testContext.mockSyncBackend.failNextPushes(1)
      yield* testContext.pushEncoded(
        eventFactory.todoCreated.next({ id: 'unknown', text: 'unknown', completed: false }),
      )

      const shutdownError = yield* Deferred.await(testContext.shutdownDeferred).pipe(Effect.flip, Effect.timeout(3000))
      expect(shutdownError._tag).toEqual('UnknownError')
      expect(yield* testContext.mockSyncBackend.pushAttemptCount).toEqual(1)
      expect(yield* testContext.mockSyncBackend.storedEvents).toEqual([])
    }).pipe(withTestCtx({ syncOptions: { livePull: false, onSyncError: 'shutdown' }, captureShutdown: true })(test)),
  )

  {
    const firstAttempt = Deferred.makeUnsafe<void>()
    let pushAttempts = 0

    Vitest.it.effect('retries positively identified offline push failures', (test) =>
      Effect.gen(function* () {
        const testContext = yield* TestContext

        yield* testContext.pushEncoded(
          testContext.eventFactory.todoCreated.next({ id: 'offline-retry', text: 'offline', completed: false }),
        )
        yield* Deferred.await(firstAttempt)
        expect(pushAttempts).toBe(1)

        yield* TestClock.adjust('2 seconds')
        yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)

        expect(pushAttempts).toBe(2)
      }).pipe(
        withTestCtx({
          syncOptions: { livePull: false, onSyncError: 'ignore' },
          mockBackendOverride: (mockBackend) => () =>
            Effect.gen(function* () {
              const syncBackend = yield* mockBackend.makeSyncBackend
              return {
                ...syncBackend,
                push: (batch) =>
                  Effect.sync(() => ++pushAttempts).pipe(
                    Effect.tap(() => Deferred.succeed(firstAttempt, undefined)),
                    Effect.flatMap((attempt) =>
                      attempt === 1
                        ? Effect.fail(new IsOfflineError({ cause: new Error('simulated offline backend') }))
                        : syncBackend.push(batch),
                    ),
                  ),
              }
            }),
        })(test),
      ),
    )
  }

  {
    const terminalWorker = Deferred.makeUnsafe<string>()
    let pushAttempts = 0

    Vitest.it.effect('parks backend push after one UnknownError attempt', (test) =>
      Effect.gen(function* () {
        const testContext = yield* TestContext

        yield* testContext.pushEncoded(
          testContext.eventFactory.todoCreated.next({ id: 'unknown-terminal', text: 'terminal', completed: false }),
        )

        expect(yield* Deferred.await(terminalWorker)).toBe('backend-push')
        expect(pushAttempts).toBe(1)

        // Crossing the first two exponential retry delays proves UnknownError did not enter the schedule.
        yield* TestClock.adjust('5 seconds')
        expect(pushAttempts).toBe(1)
        expect(yield* Deferred.isDone(testContext.shutdownDeferred)).toBe(false)
      }).pipe(
        withTestCtx({
          syncOptions: { livePull: false, onSyncError: 'ignore' },
          captureShutdown: true,
          testing: {
            syncProcessor: {
              hooks: {
                workerTerminal: ({ worker }) => Deferred.succeed(terminalWorker, worker),
              },
            },
          },
          mockBackendOverride: (mockBackend) => () =>
            Effect.gen(function* () {
              const syncBackend = yield* mockBackend.makeSyncBackend
              return {
                ...syncBackend,
                push: () =>
                  Effect.sync(() => ++pushAttempts).pipe(
                    Effect.andThen(
                      Effect.fail(new UnknownError({ cause: new Error('simulated unclassified push failure') })),
                    ),
                  ),
              }
            }),
        })(test),
      ),
    )
  }

  {
    const terminalWorker = Deferred.makeUnsafe<string>()
    let pullAttempts = 0

    Vitest.it.effect('parks backend pull after terminal failure', (test) =>
      Effect.gen(function* () {
        const testContext = yield* TestContext

        expect(yield* Deferred.await(terminalWorker)).toBe('backend-pull')
        expect(pullAttempts).toBe(1)

        yield* TestClock.adjust('5 seconds')
        expect(pullAttempts).toBe(1)
        expect(yield* Deferred.isDone(testContext.shutdownDeferred)).toBe(false)
      }).pipe(
        withTestCtx({
          syncOptions: { livePull: true, onSyncError: 'ignore' },
          captureShutdown: true,
          testing: {
            syncProcessor: {
              hooks: {
                workerTerminal: ({ worker }) => Deferred.succeed(terminalWorker, worker),
              },
            },
          },
          mockBackendOverride: (mockBackend) => () =>
            Effect.gen(function* () {
              const syncBackend = yield* mockBackend.makeSyncBackend
              return {
                ...syncBackend,
                pull: () => {
                  pullAttempts++
                  return Stream.fail(new UnknownError({ cause: new Error('simulated unclassified pull failure') }))
                },
              }
            }),
        })(test),
      ),
    )
  }

  {
    const terminalWorker = Deferred.makeUnsafe<string>()

    Vitest.live('replaces a parked backend push after pull reconciliation', (test) =>
      Effect.gen(function* () {
        const testContext = yield* TestContext
        const backendFactory = makeEventFactory({
          client: EventFactory.clientIdentity('recovery-backend', 'recovery-session'),
        })

        yield* testContext.mockSyncBackend.failNextPushes(
          1,
          () => new UnknownError({ cause: new Error('simulated uncertain push outcome') }),
        )
        yield* testContext.pushEncoded(
          testContext.eventFactory.todoCreated.next({ id: 'local-recovered', text: 'local', completed: false }),
        )
        expect(yield* Deferred.await(terminalWorker)).toBe('backend-push')

        // An authoritative pull rebases current pending and replaces the parked push worker.
        yield* testContext.mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'remote', text: 'remote', completed: false }),
        )

        const recoveredPush = yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runHead)
        assert(recoveredPush._tag === 'Some')
        expect(recoveredPush.value.args).toMatchObject({ id: 'local-recovered' })
      }).pipe(
        withTestCtx({
          syncOptions: { livePull: true, onSyncError: 'ignore' },
          testing: {
            syncProcessor: {
              hooks: {
                workerTerminal: ({ worker }) => Deferred.succeed(terminalWorker, worker),
              },
            },
          },
        })(test),
      ),
    )
  }

  {
    const terminalWorker = Deferred.makeUnsafe<string>()

    Vitest.live('parks local apply after terminal failure', (test) =>
      Effect.gen(function* () {
        const testContext = yield* TestContext

        expect(yield* Deferred.await(terminalWorker)).toBe('local-apply')
        expect(yield* Deferred.isDone(testContext.shutdownDeferred)).toBe(false)
      }).pipe(
        withTestCtx({
          syncOptions: { livePull: false, onSyncError: 'ignore' },
          captureShutdown: true,
          testing: {
            syncProcessor: {
              delays: {
                localPushProcessing: Effect.die(new Error('simulated local-apply defect')),
              },
              hooks: {
                workerTerminal: ({ worker }) => Deferred.succeed(terminalWorker, worker),
              },
            },
          },
        })(test),
      ),
    )
  }

  // Should escalate and shutdown on BackendIdMismatchError when onBackendIdMismatch='shutdown' (legacy behavior)
  Vitest.live('shutdowns on BackendIdMismatchError push', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const eventFactory = testContext.eventFactory

      // Fail the next push due to backend id mismatch
      yield* testContext.mockSyncBackend.failNextPushes(1, () =>
        Effect.fail(new BackendIdMismatchError({ expected: 'a', received: 'b' })),
      )

      // Trigger a local push
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: 'mismatch', text: 'x', completed: false }))

      // Expect a shutdown message to be sent with BackendIdMismatchError
      const shutdownMsg = yield* Deferred.await(testContext.shutdownDeferred).pipe(Effect.flip, Effect.timeout(3000))

      expect(shutdownMsg._tag).toEqual('BackendIdMismatchError')
    }).pipe(
      withTestCtx({
        syncOptions: { onBackendIdMismatch: 'shutdown', livePull: false },
        captureShutdown: true,
      })(test),
    ),
  )

  // Tests for onBackendIdMismatch option

  // Should clear databases and shutdown with IntentionalShutdownCause when onBackendIdMismatch='reset'
  Vitest.live('clears databases on BackendIdMismatchError push with reset', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const leaderThreadCtx = yield* LeaderThreadCtx
      const eventFactory = testContext.eventFactory

      // First create some data
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }))

      // Wait for local processing and backend sync to complete before arming the next push failure.
      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.takeUntil((_) => _.localHead.global === 1),
        Stream.runDrain,
      )
      yield* testContext.mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain, Effect.timeout(3000))

      // Verify data exists in eventlog before the error
      const beforeRows = leaderThreadCtx.dbEventlog.select<{ name: string }>(`SELECT name FROM eventlog`)
      expect(beforeRows.length).toBeGreaterThan(0)

      // Fail the next push due to backend id mismatch
      yield* testContext.mockSyncBackend.failNextPushes(1, () =>
        Effect.fail(new BackendIdMismatchError({ expected: 'new-id', received: 'old-id' })),
      )

      // Trigger another push that will fail
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: '2', text: 't2', completed: false }))

      // Expect a shutdown message with IntentionalShutdownCause and reason 'backend-id-mismatch'
      const shutdownMsg = yield* Deferred.await(testContext.shutdownDeferred).pipe(Effect.flip, Effect.timeout(3000))

      expect(shutdownMsg._tag).toEqual('IntentionalShutdownCause')
      expect((shutdownMsg as IntentionalShutdownCause).reason).toEqual('backend-id-mismatch')

      // Verify databases were cleared
      const afterEventlogRows = leaderThreadCtx.dbEventlog.select<{ name: string }>(`SELECT name FROM eventlog`)
      expect(afterEventlogRows.length).toBe(0)

      const afterSyncStatusRows = leaderThreadCtx.dbEventlog.select<{ head: number }>(
        `SELECT head FROM __livestore_sync_status`,
      )
      expect(afterSyncStatusRows.length).toBe(0)
    }).pipe(
      withTestCtx({ syncOptions: { onBackendIdMismatch: 'reset', livePull: false }, captureShutdown: true })(test),
    ),
  )

  // Should shutdown without clearing databases when onBackendIdMismatch='shutdown'
  Vitest.live('shutdowns without clearing on BackendIdMismatchError push with shutdown', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const leaderThreadCtx = yield* LeaderThreadCtx
      const eventFactory = testContext.eventFactory

      // First create some data
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }))

      // Wait for sync to complete
      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.takeUntil((_) => _.localHead.global === 1),
        Stream.runDrain,
      )

      // Verify data exists
      const beforeRows = leaderThreadCtx.dbEventlog.select<{ name: string }>(`SELECT name FROM eventlog`)
      expect(beforeRows.length).toBeGreaterThan(0)

      // Fail the next push due to backend id mismatch
      yield* testContext.mockSyncBackend.failNextPushes(1, () =>
        Effect.fail(new BackendIdMismatchError({ expected: 'new-id', received: 'old-id' })),
      )

      // Trigger another push that will fail
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: '2', text: 't2', completed: false }))

      // Expect a shutdown message with BackendIdMismatchError (not IntentionalShutdownCause)
      const shutdownMsg = yield* Deferred.await(testContext.shutdownDeferred).pipe(Effect.flip, Effect.timeout(3000))

      expect(shutdownMsg._tag).toEqual('BackendIdMismatchError')

      // Verify databases were NOT cleared
      const afterRows = leaderThreadCtx.dbEventlog.select<{ name: string }>(`SELECT name FROM eventlog`)
      expect(afterRows.length).toBeGreaterThan(0)
    }).pipe(
      withTestCtx({ syncOptions: { onBackendIdMismatch: 'shutdown', livePull: false }, captureShutdown: true })(test),
    ),
  )

  // Should ignore BackendIdMismatchError and continue when onBackendIdMismatch='ignore'
  Vitest.live('ignores BackendIdMismatchError push when ignore', (test) =>
    Effect.gen(function* () {
      const testContext = yield* TestContext
      const leaderThreadCtx = yield* LeaderThreadCtx
      const eventFactory = testContext.eventFactory

      // First create some data
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }))

      // Wait for sync to complete
      yield* leaderThreadCtx.syncProcessor.syncState.changes.pipe(
        Stream.takeUntil((_) => _.localHead.global === 1),
        Stream.runDrain,
      )

      // Fail the next push due to backend id mismatch
      yield* testContext.mockSyncBackend.failNextPushes(1, () =>
        Effect.fail(new BackendIdMismatchError({ expected: 'new-id', received: 'old-id' })),
      )

      // Trigger another push that will fail
      yield* testContext.pushEncoded(eventFactory.todoCreated.next({ id: '2', text: 't2', completed: false }))

      // Give some time for the error to be processed
      yield* Effect.sleep(Duration.millis(500))

      // Verify data still exists (not cleared)
      const afterRows = leaderThreadCtx.dbEventlog.select<{ name: string }>(`SELECT name FROM eventlog`)
      expect(afterRows.length).toBeGreaterThan(0)

      // Verify no shutdown happened (deferred should still be pending)
      // We use race with a small timeout to check if deferred is still pending
      const result = yield* Effect.race(
        Deferred.await(testContext.shutdownDeferred).pipe(
          Effect.flip,
          Effect.map(() => 'shutdown' as const),
        ),
        Effect.sleep(Duration.millis(100)).pipe(Effect.map(() => 'no-shutdown' as const)),
      )

      expect(result).toEqual('no-shutdown')
    }).pipe(
      withTestCtx({ syncOptions: { onBackendIdMismatch: 'ignore', livePull: false }, captureShutdown: true })(test),
    ),
  )

  // NOTE: Pull path test is skipped because the MockSyncBackend's failNextPulls works on the
  // initial pull, not on live pulls after advance. The core functionality for handling
  // BackendIdMismatchError is shared with the push path via maybeShutdownOnError.
  // The real pull scenario is tested in integration tests with actual sync providers.
  Vitest.live.skip('clears databases on BackendIdMismatchError pull with reset', (test) =>
    Effect.gen(function* () {
      // This test would require more complex mocking of the pull stream to inject errors
      // during live pulls. For now, we rely on push tests and integration tests.
    }).pipe(
      withTestCtx({ syncOptions: { onBackendIdMismatch: 'reset', livePull: true }, captureShutdown: true })(test),
    ),
  )
})

type LeaderEventFactory = ReturnType<typeof makeEventFactory>

interface PullApplicationControl {
  cursorAdvanced: Deferred.Deferred<void>
  allowApplication: Deferred.Deferred<void>
  pushWaiting: Deferred.Deferred<void>
  restartRequested: Deferred.Deferred<void>
}

class TestContext extends Context.Service<
  TestContext,
  {
    mockSyncBackend: MockSyncBackend
    shutdownDeferred: Deferred.Deferred<void, typeof Shutdown.All.Type>
    pullQueue: Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type }>
    eventFactory: LeaderEventFactory
    pullApplicationControl: PullApplicationControl | undefined
    /** Equivalent to the ClientSessionSyncProcessor calling `.push` on the LeaderThreadCtx */
    pushEncoded: (
      ...events: ReadonlyArray<LiveStoreEvent.Global.Encoded>
    ) => Effect.Effect<void, RejectedPushError, Scope.Scope | LeaderThreadCtx>
  }
>()('TestContext') {}

const LeaderThreadCtxLive = ({
  syncProcessor,
  params,
  syncOptions,
  captureShutdown,
  mockBackendOptions,
  seedMockBackend,
  mockBackendOverride,
  coordinatePullApplication,
  failCoordinatedPullApplication,
}: {
  syncProcessor?: NonNullable<MakeLeaderThreadLayerParams['testing']>['syncProcessor']
  params?: MakeLeaderThreadLayerParams['params']
  /** Optional overrides for sync options (e.g. custom backend, livePull flag) */
  syncOptions?: Partial<SyncOptions>
  captureShutdown?: boolean
  mockBackendOptions?: MockSyncBackendOptions
  seedMockBackend?: (mockBackend: MockSyncBackend) => Effect.Effect<void>
  mockBackendOverride?: (mock: MockSyncBackend) => SyncBackend.SyncBackendConstructor
  coordinatePullApplication?: boolean
  failCoordinatedPullApplication?: boolean
}) =>
  Effect.gen(function* () {
    const mockSyncBackend = yield* makeMockSyncBackend(mockBackendOptions)

    const pullApplicationControl =
      coordinatePullApplication === true
        ? {
            cursorAdvanced: yield* Deferred.make<void>(),
            allowApplication: yield* Deferred.make<void>(),
            pushWaiting: yield* Deferred.make<void>(),
            restartRequested: yield* Deferred.make<void>(),
          }
        : undefined

    if (seedMockBackend !== undefined) {
      yield* seedMockBackend(mockSyncBackend)
    }

    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
      Effect.withSpan('@livestore/sqlite-wasm:loadSqlite3Wasm'),
    )

    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })

    const shutdownProxy =
      captureShutdown === true ? yield* WebChannel.queueChannelProxy({ schema: Shutdown.All }) : undefined

    const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
    const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
    const syncBackendConstructor =
      pullApplicationControl === undefined
        ? (mockBackendOverride?.(mockSyncBackend) ?? syncOptions?.backend ?? (() => mockSyncBackend.makeSyncBackend))
        : () =>
            Effect.gen(function* () {
              const syncBackend = yield* mockSyncBackend.makeSyncBackend
              let interceptNextPush = true
              return {
                ...syncBackend,
                push: (batch: ReadonlyArray<LiveStoreEvent.Global.Encoded>) =>
                  Effect.gen(function* () {
                    if (interceptNextPush === false) return yield* syncBackend.push(batch)
                    interceptNextPush = false
                    yield* Deferred.succeed(pullApplicationControl.pushWaiting, undefined)
                    yield* Deferred.await(pullApplicationControl.cursorAdvanced)
                    return yield* new ServerAheadError({
                      minimumExpectedNum: EventSequenceNumber.Global.make(2),
                      providedNum: EventSequenceNumber.Global.make(1),
                    })
                  }),
              }
            })
    const leaderContextLayer = makeLeaderThreadLayer({
      schema,
      storeId: 'test',
      clientId: 'test',
      syncPayloadEncoded: undefined,
      syncPayloadSchema: undefined,
      makeSqliteDb,
      syncOptions: {
        backend: syncBackendConstructor,
        ...omitUndefineds({
          livePull: syncOptions?.livePull,
          onSyncError: syncOptions?.onSyncError,
          onBackendIdMismatch: syncOptions?.onBackendIdMismatch,
          initialSyncOptions: syncOptions?.initialSyncOptions,
        }),
      },
      dbState,
      dbEventlog,
      devtoolsOptions: { enabled: false },
      shutdownChannel: shutdownProxy?.webChannel ?? (yield* WebChannel.noopChannel<any, any>()),
      testing: {
        syncProcessor:
          pullApplicationControl === undefined
            ? syncProcessor
            : {
                ...syncProcessor,
                hooks: {
                  ...syncProcessor?.hooks,
                  backendPullCursorAdvanced: () =>
                    Effect.gen(function* () {
                      yield* Deferred.succeed(pullApplicationControl.cursorAdvanced, undefined)
                      yield* Deferred.await(pullApplicationControl.allowApplication)
                      if (failCoordinatedPullApplication === true) {
                        return yield* Effect.die(new Error('simulated canonical pull application failure'))
                      }
                    }),
                  backendPullRestartRequested: () =>
                    Deferred.succeed(pullApplicationControl.restartRequested, undefined),
                },
              },
      },
      ...omitUndefineds({ params }),
    }).pipe(Layer.provide(StateHead.layer({ dbState })), Layer.provide(FetchHttpClient.layer))

    const testContextLayer = Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx

      const eventFactory = makeEventFactory({
        client: EventFactory.clientIdentity(leaderThreadCtx.clientId, 'static-session-id'),
      })

      const toEncodedWithMeta = (event: LiveStoreEvent.Global.Encoded) =>
        new LiveStoreEvent.Client.EncodedWithMeta({
          ...LiveStoreEvent.Global.toClientEncoded(event),
        })

      const pushEncoded = (...events: ReadonlyArray<LiveStoreEvent.Global.Encoded>) =>
        leaderThreadCtx.syncProcessor.push(events.map((event) => toEncodedWithMeta(event)))

      const pullQueue = yield* leaderThreadCtx.syncProcessor.pullQueue({
        cursor: EventSequenceNumber.Client.ROOT,
      })

      const shutdownDeferred = yield* Deferred.make<void, typeof Shutdown.All.Type>()

      if (shutdownProxy !== undefined) {
        yield* Queue.take(shutdownProxy.sendQueue).pipe(
          Effect.flip,
          Effect.exit,
          Effect.flatMap((exit) => Deferred.done(shutdownDeferred, exit)),
          Effect.forkScoped,
        )
      }

      return Layer.succeed(
        TestContext,
        TestContext.of({
          mockSyncBackend,
          shutdownDeferred,
          pullQueue,
          eventFactory,
          pullApplicationControl,
          pushEncoded,
        }),
      )
    }).pipe(Layer.unwrap, Layer.provide(leaderContextLayer))

    return leaderContextLayer.pipe(Layer.merge(testContextLayer))
  }).pipe(Layer.unwrap)
