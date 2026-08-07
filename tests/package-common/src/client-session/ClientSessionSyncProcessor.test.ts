import { assert, expect } from 'vitest'

import type { LockStatus, MockSyncBackend } from '@livestore/common'
import {
  type BootStatus,
  type ClientSession,
  type ClientSessionLeaderThreadProxy,
  LeaderAheadError,
  makeMockSyncBackend,
  StateHead,
  SyncState,
  type UnknownError,
} from '@livestore/common'
import { Eventlog, makeMaterializeEvent, recreateDb } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventSequenceNumber, LiveStoreEvent, SystemTables } from '@livestore/common/schema'
import {
  type ClientSessionSyncProcessor,
  makeClientSessionSyncProcessor,
  type SyncBackend,
} from '@livestore/common/sync'
import { EventFactory } from '@livestore/common/testing'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred, StoreInternalsSymbol } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Cache,
  type OtelTracer,
  Cause,
  Context,
  Deferred,
  Effect,
  Equal,
  Exit,
  FastCheck,
  FetchHttpClient,
  Fiber,
  Hash,
  Latch,
  Layer,
  Option,
  Queue,
  References,
  Result,
  Schema,
  Scope,
  Stream,
  Subscribable,
  SubscriptionRef,
  TestClock,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'

import { events, schema, tables } from '../leader-thread/fixture.ts'
import { makeTestAdapter, type TestingOverrides } from '../test-adapter.ts'

// TODO fix type level - derived events are missing and thus infers to `never` currently
const eventSchema = LiveStoreEvent.Input.makeSchema(schema) as TODO as Schema.Codec<LiveStoreEvent.Input.Encoded>
const encode = Schema.encodeSync(eventSchema)

const withTestCtx = Vitest.makeWithTestCtx({
  makeLayer: () =>
    Layer.mergeAll(
      TestContextLive,
      PlatformNode.NodeFileSystem.layer,
      FetchHttpClient.layer,
      Layer.succeed(References.MinimumLogLevel, 'Debug'),
    ),
})

type LeaderEvents = ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy['events']
type ClientProcessorParams = Parameters<typeof makeClientSessionSyncProcessor>[0]

const makeClientProcessorHarness = Effect.fn(function* ({
  push,
  pull = () => Stream.empty,
  rollback = () => undefined,
  shutdown = () => Effect.void,
  devtools = { enabled: false },
  leaderPushBatchSize = 1,
  rebaseBarriers,
}: {
  push: LeaderEvents['push']
  pull?: LeaderEvents['pull']
  rollback?: (changeset: Uint8Array<ArrayBuffer>) => void
  shutdown?: ClientSession['shutdown']
  devtools?: ClientSession['devtools']
  leaderPushBatchSize?: number
  rebaseBarriers?: ClientProcessorParams['params']['rebaseBarriers']
}) {
  const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')
  const leaderThread: ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy = {
    events: { pull, push, stream: () => Stream.empty },
    initialState: {
      leaderHead: EventSequenceNumber.Client.ROOT,
      migrationsReport: { migrations: [] },
      storageMode: 'persisted',
    },
    export: Effect.die(new Error('not implemented')),
    getEventlogData: Effect.die(new Error('not implemented')),
    syncState: Subscribable.make({
      get: Effect.die(new Error('not implemented')),
      changes: Stream.empty,
    }),
    sendDevtoolsMessage: () => Effect.void,
    networkStatus: Subscribable.make({
      get: Effect.die(new Error('not implemented')),
      changes: Stream.empty,
    }),
  }

  const clientSession: ClientSession = {
    sqliteDb: {} as ClientSession['sqliteDb'],
    devtools,
    clientId: 'client-test',
    sessionId: 'session-test',
    lockStatus,
    shutdown,
    leaderThread,
    debugInstanceId: 'test-instance',
  }

  const processor = yield* makeClientSessionSyncProcessor({
    schema: schema as LiveStoreSchema,
    clientSession,
    materializeEvent: () =>
      Effect.succeed({
        writeTables: new Set<string>(),
        sessionChangeset: { _tag: 'no-op' as const },
        materializerHash: Option.none<number>(),
      }),
    rollback,
    refreshTables: () => undefined,
    params: { leaderPushBatchSize, rebaseBarriers },
    confirmUnsavedChanges: false,
  }).pipe(Effect.provide(StateHead.layerTest))

  const scope = yield* Scope.make()
  yield* processor.boot.pipe(Scope.provide(scope))

  const pushIds = Effect.fn(function* (ids: ReadonlyArray<string>) {
    const encoded = yield* processor.encodeEvents(
      ids.map((id) => events.todoCreated({ id, text: id, completed: false })),
    )
    yield* processor.push(encoded)
    return encoded
  })

  const close = (exit: Exit.Exit<unknown, unknown> = Exit.void) =>
    processor.shutdown(exit).pipe(Effect.ensuring(Scope.close(scope, exit)))

  return { processor, pushIds, close, scope }
})

// TODO use property tests for simulation params
/** Verifies: LS.SYS.SYNC.SS-R01, LS.SYS.SYNC.SS-R04, LS.SYS.SYNC.PROC-R04 */
Vitest.describe.concurrent('ClientSessionSyncProcessor', () => {
  Vitest.live('from scratch', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()

      store.commit(events.todoCreated({ id: '1', text: 't1', completed: false }))

      const syncState = yield* store[StoreInternalsSymbol].syncProcessor.syncState.get
      expect(yield* StateHead.make({ dbState: store[StoreInternalsSymbol].sqliteDbWrapper }).get).toEqual(
        syncState.localHead,
      )

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('does not send a later pending event before its rejected prefix is reconciled', (test) =>
    Effect.gen(function* () {
      const shutdownDeferred = yield* makeShutdownDeferred
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushRejected = yield* Deferred.make<void>()
      const laterPushAccepted = yield* Deferred.make<void>()
      const pushedIds: string[] = []
      let pushCount = 0
      const adapter = makeTestAdapter({
        clientId: 'client-2',
        sessionId: 'session-2',
        testing: {
          overrides: {
            clientSession: {
              leaderThreadProxy: () => ({
                events: {
                  pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
                  push: (batch) =>
                    Effect.gen(function* () {
                      pushCount++
                      pushedIds.push(...batch.map((event) => event.args.id as string))
                      if (pushCount === 1) {
                        yield* Deferred.succeed(firstPushRejected, undefined)
                        return yield* new LeaderAheadError({
                          minimumExpectedNum: EventSequenceNumber.Client.ROOT,
                          providedNum: batch[0]!.seqNum,
                          sessionId: batch[0]!.sessionId,
                        })
                      }
                      yield* Deferred.succeed(laterPushAccepted, undefined)
                    }),
                  stream: () => Stream.empty,
                },
              }),
            },
          },
        },
      })
      const store = yield* createStore({
        schema: schema as LiveStoreSchema,
        adapter,
        storeId: 'sf-03-overlapping-advance',
        shutdownDeferred,
      })

      store.commit(events.todoCreated({ id: 'older-pending', text: 'older', completed: false }))
      yield* Deferred.await(firstPushRejected)
      yield* store[StoreInternalsSymbol].syncProcessor.debug.awaitRejection

      const rejectedPrefix = (yield* store[StoreInternalsSymbol].syncProcessor.syncState.get).pending[0]!
      store.commit(events.todoCreated({ id: 'later-pending', text: 'later', completed: false }))

      // The old worker loop drained `later-pending` here. Its leader delivery then appeared before
      // `older-pending`, producing merge materialization `[B, A', B']` and the SF-03 UNIQUE failure.
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(laterPushAccepted)).toBe(false)

      const recovered = store[StoreInternalsSymbol].syncProcessor.syncState.changes.pipe(
        Stream.filter(
          (state) =>
            EventSequenceNumber.Client.isEqual(state.upstreamHead, rejectedPrefix.seqNum) === true &&
            state.pending.length === 1,
        ),
        Stream.take(1),
        Stream.runDrain,
        Effect.raceFirst(Deferred.await(shutdownDeferred)),
        Effect.forkChild,
      )
      const recoveredFiber = yield* recovered

      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [rejectedPrefix] }))
      yield* Fiber.join(recoveredFiber)
      yield* Deferred.await(laterPushAccepted)

      expect(
        store
          .query(tables.todos)
          .map((row) => row.id)
          .toSorted(),
      ).toEqual(['later-pending', 'older-pending'])
      expect(pushedIds).toEqual(['older-pending', 'later-pending'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('rolls back materialized state when persisting the state head fails', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()
      const { sqliteDbWrapper, syncProcessor } = store[StoreInternalsSymbol]
      const encodedEvents = yield* syncProcessor.encodeEvents([
        events.todoCreated({ id: 'rolled-back', text: 'rolled-back', completed: false }),
      ])

      sqliteDbWrapper.execute(`DROP TABLE ${SystemTables.STATE_HEAD_META_TABLE}`)

      const exit = yield* syncProcessor.materializeEvents(encodedEvents).pipe(Effect.exit)

      expect(exit._tag).toEqual('Failure')
      expect(sqliteDbWrapper.select(tables.todos.asSql().query)).toEqual([])
    }).pipe(withTestCtx(test)),
  )

  // TODO also add a test where there's a merge conflict in the leader <> backend
  Vitest.live('commits during boot', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore({
        boot: (store) => {
          store.commit(events.todoCreated({ id: '0', text: 't0', completed: false }))
        },
        testing: {
          overrides: {
            clientSession: {
              leaderThreadProxy: (leader) => ({
                events: {
                  pull: ({ cursor }) =>
                    Effect.gen(function* () {
                      yield* Effect.sleep(1000)
                      return leader.events.pull({ cursor })
                    }).pipe(Stream.unwrap),
                  push: leader.events.push,
                  stream: leader.events.stream,
                },
              }),
            },
          },
        },
      })

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)

      // Make sure pending events are processed
      yield* store[StoreInternalsSymbol].syncProcessor.syncState.changes.pipe(
        Stream.filter((_) => _.pending.length === 0),
        Stream.take(1),
        Stream.runDrain,
      )
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('sync backend is ahead', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      const store = yield* makeStore()

      store.commit(events.todoCreated({ id: '2', text: 't2', completed: false }))

      yield* mockSyncBackend.advance(eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }))

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('race condition between client session and sync backend', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      const store = yield* makeStore()

      for (let i = 0; i < 5; i++) {
        yield* mockSyncBackend
          .advance(eventFactory.todoCreated.next({ id: `backend_${i}`, text: '', completed: false }))
          .pipe(Effect.forkChild)
      }

      for (let i = 0; i < 5; i++) {
        store.commit(events.todoCreated({ id: `local_${i}`, text: '', completed: false }))
      }

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(5), Stream.runDrain)
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('client document pending events confirm after upstream advance', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const backendFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      const store = yield* makeStore()

      store.commit(tables.appConfig.set({ theme: 'dark' }, 'session-a'))

      const initialState = yield* store[StoreInternalsSymbol].syncProcessor.syncState.get
      expect(initialState.pending.length).toBeGreaterThan(0)
      expect(initialState.pending[0]?.seqNum.client ?? 0).toBeGreaterThan(0)
      expect(initialState.pending[0]?.name).toEqual('app_configSet')

      yield* mockSyncBackend.advance(
        backendFactory.todoCreated.next({ id: 'backend_rebase', text: '', completed: false }),
      )

      yield* store[StoreInternalsSymbol].syncProcessor.syncState.changes.pipe(
        Stream.filter(
          (state) =>
            state.pending.length === 0 && EventSequenceNumber.Client.isEqual(state.localHead, state.upstreamHead),
        ),
        Stream.take(1),
        Stream.runDrain,
        Effect.timeout('2 seconds'),
      )

      const finalState = yield* store[StoreInternalsSymbol].syncProcessor.syncState.get
      expect(finalState.pending.length).toEqual(0)
      expect(EventSequenceNumber.Client.isEqual(finalState.localHead, finalState.upstreamHead)).toBe(true)
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('should fail for event that is not larger than expected upstream', (test) =>
    Effect.gen(function* () {
      const shutdownDeferred = yield* makeShutdownDeferred
      const pullQueue = yield* Queue.unbounded<LiveStoreEvent.Client.EncodedWithMeta>()

      const adapter = makeTestAdapter({
        testing: {
          overrides: {
            clientSession: {
              leaderThreadProxy: () => ({
                events: {
                  pull: () =>
                    Stream.fromQueue(pullQueue).pipe(
                      Stream.map((item) => ({
                        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [item] }),
                      })),
                    ),
                  push: () => Effect.void,
                  stream: () => Stream.empty,
                },
              }),
            },
          },
        },
      })

      const _store = yield* createStore({
        schema: schema as LiveStoreSchema,
        adapter,
        storeId: nanoid(),
        shutdownDeferred,
      })

      const eventSchema = LiveStoreEvent.Input.makeSchema(schema) as TODO as Schema.Codec<LiveStoreEvent.Input.Encoded>

      yield* Queue.offer(
        pullQueue,
        LiveStoreEvent.Client.EncodedWithMeta.make({
          ...(yield* Schema.encodeEffect(eventSchema)(events.todoCreated({ id: `id_0`, text: '', completed: false }))),
          seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
          parentSeqNum: EventSequenceNumber.Client.ROOT,
          clientId: 'other-client',
          sessionId: 'static-session-id',
        }),
      ).pipe(Effect.repeat({ times: 1 }))

      // Merge invariant violations are defects (not typed errors), so the shutdown
      // deferred receives an Exit with a Die cause containing the error message.
      const exit = yield* Effect.exit(Deferred.await(shutdownDeferred))

      expect(Exit.isFailure(exit)).toBe(true)
      assert(Exit.isFailure(exit))

      const defect = Cause.findDefect(exit.cause)
      expect(Result.isSuccess(defect)).toBe(true)
      assert(Result.isSuccess(defect))

      expect(defect.success).toBeInstanceOf(Error)
      assert(defect.success instanceof Error)

      expect(defect.success.message).toEqual(
        'Incoming events must be greater than upstream head. Expected greater than: e1. Received: [e1]',
      )
    }).pipe(withTestCtx(test)),
  )

  // Scenario:
  // - client reboots with some persisted pending changes
  // - when client boots, it pulls some conflicting changes from the sync backend
  // - the client needs to rebase and those rebased changes need to be propagated to the client session
  //
  // related problem: the same might happen during leader re-election in the web adapter (will need proper tests as well some day)
  Vitest.live('client should push pending persisted events on start', (test) =>
    Effect.gen(function* () {
      const { mockSyncBackend } = yield* TestContext
      const shutdownDeferred = yield* makeShutdownDeferred

      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'other-client-session1'),
      })

      yield* mockSyncBackend.advance(eventFactory.todoCreated.next({ id: `backend_0`, text: 't2', completed: false }))

      type MakeLeaderThread = NonNullable<TestingOverrides['makeLeaderThread']>
      type MakeLeaderThreadArg = Parameters<MakeLeaderThread>[0]

      class LeaderThreadCacheKey {
        constructor(readonly makeSqliteDb: MakeLeaderThreadArg) {}

        [Equal.symbol](that: Equal.Equal): boolean {
          return that instanceof LeaderThreadCacheKey
        }

        [Hash.symbol](): number {
          return 0
        }
      }

      const leaderThreadCache = yield* Cache.make({
        capacity: Number.POSITIVE_INFINITY,
        lookup: ({ makeSqliteDb }: LeaderThreadCacheKey) =>
          Effect.gen(function* () {
            const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

            yield* Eventlog.initEventlogDb(dbEventlog)

            yield* Eventlog.insertIntoEventlog(
              LiveStoreEvent.Client.EncodedWithMeta.make({
                ...encode(events.todoCreated({ id: `client_0`, text: 't1', completed: false })),
                clientId: 'client',
                seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
                parentSeqNum: EventSequenceNumber.Client.ROOT,
                sessionId: 'client-session1',
              }),
              dbEventlog,
              Schema.hash(events.todoCreated.schema),
              'client',
              'client-session1',
            )

            const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })

            const bootStatusQueue = yield* Queue.unbounded<BootStatus>()
            const materializeEvent = yield* makeMaterializeEvent({ schema, dbState, dbEventlog }).pipe(
              Effect.provide(StateHead.layer({ dbState })),
            )
            yield* recreateDb({ dbState, dbEventlog, schema, bootStatusQueue, materializeEvent })

            return { dbEventlog, dbState }
          }).pipe(Effect.orDie),
      })

      const makeLeaderThread: MakeLeaderThread = (makeSqliteDb) =>
        Cache.get(leaderThreadCache, new LeaderThreadCacheKey(makeSqliteDb))

      const adapter = makeTestAdapter({
        sync: {
          backend: () => mockSyncBackend.makeSyncBackend,
          initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
        },
        testing: { overrides: { makeLeaderThread } },
      })

      const store = yield* createStore({
        schema: schema as LiveStoreSchema,
        adapter,
        storeId: nanoid(),
        shutdownDeferred,
      })

      // Wait for the sync backend to receive the pushed event
      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)

      // `syncState.get` advances before rollback and materialization, while `changes` is emitted afterward.
      // Always consume the queued e2 update so the query below observes the fully rebased state.
      yield* store[StoreInternalsSymbol].syncProcessor.syncState.changes.pipe(
        Stream.takeUntil((_) => _.localHead.global === 2),
        Stream.runDrain,
      )

      const res = store.query(tables.todos.orderBy('text', 'asc'))

      expect(res).toMatchObject([
        { id: 'client_0', text: 't1', completed: false, deletedAt: null },
        { id: 'backend_0', text: 't2', completed: false, deletedAt: null },
      ])

      const syncState = yield* store[StoreInternalsSymbol].syncProcessor.syncState.get
      expect(yield* StateHead.make({ dbState: store[StoreInternalsSymbol].sqliteDbWrapper }).get).toEqual(
        syncState.localHead,
      )
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('drains in-flight and queued leader pushes serially on shutdown', (test) =>
    Effect.gen(function* () {
      const firstPushStarted = yield* Deferred.make<void>()
      const releaseFirstPush = yield* Deferred.make<void>()
      const persistedBatches: ReadonlyArray<LiveStoreEvent.Client.Encoded>[] = []
      let isFirstPush = true
      let activePushCount = 0
      let maxActivePushCount = 0

      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        push: (batch) =>
          Effect.gen(function* () {
            activePushCount++
            maxActivePushCount = Math.max(maxActivePushCount, activePushCount)

            if (isFirstPush === true) {
              isFirstPush = false
              yield* Deferred.succeed(firstPushStarted, undefined)
              yield* Deferred.await(releaseFirstPush)
            }

            persistedBatches.push(batch)
            activePushCount--
          }),
      })

      yield* pushIds(['first'])
      yield* Deferred.await(firstPushStarted)
      yield* pushIds(['second'])
      yield* pushIds(['third'])

      const closeFiber = yield* close().pipe(Effect.forkChild)
      yield* processor.debug.awaitDrainStarted
      yield* Deferred.succeed(releaseFirstPush, undefined)
      yield* Fiber.join(closeFiber)

      const postShutdownPushExit = yield* Effect.exit(pushIds(['post-shutdown']))

      expect(maxActivePushCount).toBe(1)
      expect(persistedBatches.map((batch) => batch.map((event) => event.args.id))).toEqual([
        ['first'],
        ['second'],
        ['third'],
      ])
      expect(Exit.isFailure(postShutdownPushExit)).toBe(true)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('admits synchronous pushes while pull waits on the devtools latch', (test) =>
    Effect.gen(function* () {
      const pullLatch = yield* Latch.make(false)
      const pushLatch = yield* Latch.make(true)
      const pullStarted = yield* Deferred.make<void>()

      const { processor, close } = yield* makeClientProcessorHarness({
        devtools: { enabled: true, pullLatch, pushLatch },
        pull: () =>
          Stream.fromEffect(
            Deferred.succeed(pullStarted, undefined).pipe(
              Effect.as({ payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [] }) }),
            ),
          ),
        push: () => Effect.void,
      })
      yield* Deferred.await(pullStarted)
      yield* Effect.yieldNow

      const localEvents = yield* processor.encodeEvents([
        events.todoCreated({ id: 'local', text: 'local', completed: false }),
      ])
      const pushExit = yield* Effect.sync(() => Effect.runSyncExit(processor.push(localEvents)))

      expect(Exit.isSuccess(pushExit)).toBe(true)
      yield* close()
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('publishes local pending state before the leader worker observes the batch', (test) =>
    Effect.gen(function* () {
      const observedPendingState = yield* Deferred.make<boolean>()
      let processorRef: ClientSessionSyncProcessor | undefined

      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        push: (batch) =>
          Effect.gen(function* () {
            const activeProcessor = processorRef
            if (activeProcessor === undefined) return yield* Effect.die(new Error('Processor not initialized'))
            const syncState = yield* activeProcessor.syncState.get
            yield* Deferred.succeed(
              observedPendingState,
              batch.every((event) =>
                syncState.pending.some((pending) => LiveStoreEvent.Client.isEqualEncoded(pending, event)),
              ),
            )
          }),
      })
      processorRef = processor

      yield* pushIds(['local'])

      expect(yield* Deferred.await(observedPendingState)).toBe(true)
      yield* close()
    }).pipe(withTestCtx(test)),
  )

  Vitest.asProp(
    Vitest.live,
    'preserves event order and batch bounds through graceful shutdown',
    [
      FastCheck.integer({ min: 1, max: 5 }),
      FastCheck.array(FastCheck.integer({ min: 1, max: 4 }), { minLength: 0, maxLength: 6 }),
    ] as const,
    ([leaderPushBatchSize, pushGroupSizes], test) =>
      Effect.gen(function* () {
        const persistedBatches: ReadonlyArray<LiveStoreEvent.Client.Encoded>[] = []

        const { pushIds, close } = yield* makeClientProcessorHarness({
          leaderPushBatchSize,
          push: (batch) =>
            Effect.sync(() => {
              persistedBatches.push(batch)
            }),
        })

        const expectedIds: string[] = []
        for (const groupSize of pushGroupSizes) {
          const groupIds = Array.from({ length: groupSize }, (_, index) => `event-${expectedIds.length + index}`)
          expectedIds.push(...groupIds)
          yield* pushIds(groupIds)
        }

        yield* close()

        expect(persistedBatches.flatMap((batch) => batch.map((event) => event.args.id))).toEqual(expectedIds)
        expect(persistedBatches.every((batch) => batch.length > 0 && batch.length <= leaderPushBatchSize)).toBe(true)
      }).pipe(withTestCtx(test)),
    { fastCheck: { numRuns: 50 } },
  )

  // Deterministic barrier: the returned `effect` (handed to the processor via `rebaseBarriers`)
  // signals `reached` when the rebase parks at the point, then blocks until `release` is called.
  // This replaces the previous virtual-time `simSleep` injection, which was flaky and — as filed in
  // #1465 — misaligned with the source's simulation points (it never covered the discard step).
  const makeRebaseBarrier = Effect.fn(function* () {
    const reached = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    return {
      effect: Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(release))),
      awaitReached: Deferred.await(reached),
      release: Deferred.succeed(release, undefined).pipe(Effect.asVoid),
    }
  })

  // Builds a leader payload that conflicts with the local pending event, forcing a rebase.
  const makeConflictingUpstream = Effect.fn(function* (processor: ClientSessionSyncProcessor) {
    const [remoteBase] = yield* processor.encodeEvents([
      events.todoCreated({ id: 'remote', text: 'remote', completed: false }),
    ])
    const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
      ...remoteBase!,
      seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
      parentSeqNum: EventSequenceNumber.Client.ROOT,
      clientId: 'remote-client',
      sessionId: 'remote-session',
    })
    return SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] })
  })

  // F1 no-loss oracle (Fix for #1465 §3 torn-`syncStateRef` race): a `push` admitted while the pull
  // fiber is parked mid-rebase — right before the queue reconcile ("discard" step) — must NOT be lost.
  // The guard is the atomic reconcile re-reading the LIVE `syncStateRef.current.pending`. Reverting the
  // reconcile to the stale `mergeResult.newSyncState.pending` snapshot makes this test fail (the
  // concurrently-admitted event is cleared from the queue and never re-offered → never pushed).
  Vitest.it.effect('does not lose a push admitted during the rebase discard window', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushStarted = yield* Deferred.make<void>()
      const persistedIds: string[] = []
      let pushCallCount = 0

      const reconcileBarrier = yield* makeRebaseBarrier()

      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        // First push (the initial 'local' admission) blocks so 'local' stays pending until the
        // conflicting upstream forces a rebase; the rebase interrupts it. Later pushes record.
        push: (batch) => {
          pushCallCount++
          return pushCallCount === 1
            ? Deferred.succeed(firstPushStarted, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.sync(() => persistedIds.push(...batch.map((event) => event.args.id as string)))
        },
        rebaseBarriers: { before_queue_reconcile: reconcileBarrier.effect },
      })

      yield* pushIds(['local'])
      yield* Deferred.await(firstPushStarted)

      // Force the rebase and let it park right before the atomic queue reconcile.
      yield* Queue.offer(pullQueue, yield* makeConflictingUpstream(processor))
      yield* reconcileBarrier.awaitReached

      // Concurrently admit a new push while the rebase is parked (models a `store.commit()` landing
      // during a rebase). It appends to `syncStateRef.current.pending` and to the leader push queue.
      yield* pushIds(['concurrent'])

      // Resume the rebase: the reconcile must re-read the LIVE pending and preserve 'concurrent'.
      yield* reconcileBarrier.release

      // Draining via orderly shutdown flushes every queued event to the leader.
      yield* close()

      expect(processor.debug.debugInfo().rebaseCount).toBe(1)
      expect(persistedIds).toContain('concurrent')
      expect(persistedIds).toContain('local')
    }).pipe(withTestCtx(test)),
  )

  // F1 no-loss oracle for shutdown↔rebase (guarded by the `pullReconciliationMutex` permit shared by the
  // pull tap and `runShutdown`): an orderly shutdown that interleaves a rebase at any point of the
  // discard→re-offer window must still flush the rebased pending event. Removing the permit from
  // `runShutdown` makes the pre-reconcile cases (points 1/2) fail — the queue is ended and the pull
  // fiber interrupted before the rebased event is re-offered.
  for (const barrierPoint of [
    'before_leader_push_fiber_interrupt',
    'before_queue_reconcile',
    'before_leader_push_fiber_run',
  ] as const) {
    Vitest.it.effect(`does not lose the rebased pending event when shutdown interleaves at ${barrierPoint}`, (test) =>
      Effect.gen(function* () {
        const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
        const firstPushStarted = yield* Deferred.make<void>()
        const persistedIds: string[] = []
        let pushCallCount = 0

        const barrier = yield* makeRebaseBarrier()

        const { processor, pushIds, close } = yield* makeClientProcessorHarness({
          pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
          push: (batch) => {
            pushCallCount++
            return pushCallCount === 1
              ? Deferred.succeed(firstPushStarted, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.sync(() => persistedIds.push(...batch.map((event) => event.args.id as string)))
          },
          rebaseBarriers: { [barrierPoint]: barrier.effect },
        })

        yield* pushIds(['local'])
        yield* Deferred.await(firstPushStarted)

        yield* Queue.offer(pullQueue, yield* makeConflictingUpstream(processor))
        yield* barrier.awaitReached

        // Start an orderly shutdown while the rebase is parked. The success path takes the
        // `pullReconciliationMutex` permit still held by the parked pull fiber, so it cannot end the queue
        // until the rebase releases the permit (i.e. after re-offering the rebased pending event).
        const closeFiber = yield* close().pipe(Effect.forkChild)
        yield* barrier.release
        yield* Fiber.join(closeFiber)

        expect(processor.debug.debugInfo().rebaseCount).toBe(1)
        expect(persistedIds).toEqual(['local'])
      }).pipe(withTestCtx(test)),
    )
  }
  Vitest.it.effect('interrupts a hung leader push during failed shutdown', (test) =>
    Effect.gen(function* () {
      const firstPushStarted = yield* Deferred.make<void>()
      const firstPushInterrupted = yield* Deferred.make<void>()
      let shutdownCalls = 0
      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        shutdown: () =>
          Effect.sync(() => {
            shutdownCalls++
          }),
        push: () =>
          Deferred.succeed(firstPushStarted, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(firstPushInterrupted, undefined)),
          ),
      })

      yield* pushIds(['blocked'])
      yield* Deferred.await(firstPushStarted)

      // @effect-diagnostics-next-line globalErrorInEffectFailure:off -- test-only synthetic shutdown failure fed to close; a tagged error adds no value for this throwaway test signal
      yield* close(Exit.fail(new Error('test shutdown failure')))

      expect(yield* Deferred.isDone(firstPushInterrupted)).toBe(true)
      expect(shutdownCalls).toBe(0)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('does not report a successful drain when the leader rejects during shutdown', (test) =>
    Effect.gen(function* () {
      const pushStarted = yield* Deferred.make<void>()
      const rejectPush = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        push: () =>
          Deferred.succeed(pushStarted, undefined).pipe(
            Effect.andThen(Deferred.await(rejectPush)),
            Effect.andThen(Effect.fail(rejection)),
          ),
      })

      yield* pushIds(['rejected'])
      yield* Deferred.await(pushStarted)

      const closeFiber = yield* close().pipe(Effect.exit, Effect.forkChild)
      yield* processor.debug.awaitDrainStarted
      yield* Deferred.succeed(rejectPush, undefined)
      const closeExit = yield* Fiber.join(closeFiber)

      expect(Exit.isFailure(closeExit)).toBe(true)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('fails the drain when pull stops before a leader rejection can recover', (test) =>
    Effect.gen(function* () {
      const pullStopped = yield* Deferred.make<void>()
      const pushStarted = yield* Deferred.make<void>()
      const rejectPush = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      const { pushIds, close } = yield* makeClientProcessorHarness({
        pull: () => Stream.never.pipe(Stream.ensuring(Deferred.succeed(pullStopped, undefined))),
        push: () =>
          Deferred.succeed(pushStarted, undefined).pipe(
            Effect.andThen(Deferred.await(rejectPush)),
            Effect.andThen(Effect.fail(rejection)),
          ),
      })

      yield* pushIds(['rejected-after-pull'])
      yield* Deferred.await(pushStarted)

      const closeFiber = yield* close().pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(pullStopped)
      yield* Deferred.succeed(rejectPush, undefined)
      const closeExit = yield* Fiber.join(closeFiber)

      expect(Exit.isFailure(closeExit)).toBe(true)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('does not treat an unrelated pull advance as recovery from a rejected push', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const pushReturned = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => Effect.fail(rejection).pipe(Effect.ensuring(Deferred.succeed(pushReturned, undefined))),
      })

      yield* pushIds(['still-pending'])
      // Drain the local-push notification so the next observed change belongs to the explicit upstream payload.
      yield* processor.syncState.changes.pipe(Stream.take(1), Stream.runDrain)
      yield* Deferred.await(pushReturned)
      yield* processor.debug.awaitRejection

      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [] }))
      yield* processor.syncState.changes.pipe(Stream.take(1), Stream.runDrain)

      const closeExit = yield* close().pipe(Effect.exit)

      expect(Exit.isFailure(closeExit)).toBe(true)
      expect((yield* processor.syncState.get).pending.map((event) => event.args.id)).toEqual(['still-pending'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('does not leave a fence behind when pull recovers an in-flight push before it rejects', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushStarted = yield* Deferred.make<void>()
      const releaseFirstPush = yield* Deferred.make<void>()
      const laterPushAccepted = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0
      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          return pushCount === 1
            ? Deferred.succeed(firstPushStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseFirstPush)),
                Effect.andThen(Effect.fail(rejection)),
              )
            : Deferred.succeed(laterPushAccepted, undefined).pipe(Effect.asVoid)
        },
      })

      const [inFlightEvent] = yield* pushIds(['in-flight'])
      yield* Deferred.await(firstPushStarted)

      const recoveredFiber = yield* processor.syncState.changes.pipe(
        Stream.filter((state) => state.pending.length === 0),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild,
      )
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [inFlightEvent!] }))
      yield* Fiber.join(recoveredFiber)

      yield* Deferred.succeed(releaseFirstPush, undefined)
      yield* processor.debug.awaitRejection
      yield* pushIds(['after-late-rejection'])
      yield* Deferred.await(laterPushAccepted)

      const closeExit = yield* close().pipe(Effect.exit)
      expect(Exit.isSuccess(closeExit)).toBe(true)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('reseeds the complete pending suffix when a rebase recovers a rejection', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushRejected = yield* Deferred.make<void>()
      const rebasedSuffixAccepted = yield* Deferred.make<void>()
      const acceptedIds: string[] = []
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0
      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: (batch) => {
          pushCount++
          if (pushCount === 1) {
            return Effect.fail(rejection).pipe(Effect.ensuring(Deferred.succeed(firstPushRejected, undefined)))
          }
          return Effect.sync(() => acceptedIds.push(...batch.map((event) => event.args.id as string))).pipe(
            Effect.flatMap((acceptedCount) =>
              acceptedCount < 2 ? Effect.void : Deferred.succeed(rebasedSuffixAccepted, undefined).pipe(Effect.asVoid),
            ),
          )
        },
      })

      yield* pushIds(['rejected-prefix'])
      yield* Deferred.await(firstPushRejected)
      yield* processor.debug.awaitRejection
      yield* pushIds(['newer-pending'])
      yield* Effect.yieldNow
      expect(acceptedIds).toEqual([])

      yield* Queue.offer(pullQueue, yield* makeConflictingUpstream(processor))
      yield* Deferred.await(rebasedSuffixAccepted)

      const closeExit = yield* close().pipe(Effect.exit)
      expect(Exit.isSuccess(closeExit)).toBe(true)
      expect(acceptedIds).toEqual(['rejected-prefix', 'newer-pending'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('fences newer admitted events until the rejected prefix is recovered', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const secondPushAccepted = yield* Deferred.make<void>()
      const firstPushRejected = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0
      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          return pushCount === 1
            ? Effect.fail(rejection).pipe(Effect.ensuring(Deferred.succeed(firstPushRejected, undefined)))
            : Deferred.succeed(secondPushAccepted, undefined).pipe(Effect.asVoid)
        },
      })

      const [rejectedEvent] = yield* pushIds(['rejected-prefix'])
      yield* Deferred.await(firstPushRejected)
      yield* processor.debug.awaitRejection
      yield* pushIds(['newer-admitted'])
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(secondPushAccepted)).toBe(false)
      // Drain both local notifications so the next one proves the upstream confirmation was processed.
      yield* processor.syncState.changes.pipe(Stream.take(2), Stream.runDrain)

      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [rejectedEvent!] }))
      yield* processor.syncState.changes.pipe(Stream.take(1), Stream.runDrain)
      yield* Deferred.await(secondPushAccepted)

      const closeExit = yield* close().pipe(Effect.exit)

      expect(Exit.isSuccess(closeExit)).toBe(true)
      expect((yield* processor.syncState.get).pending.map((event) => event.args.id)).toEqual(['newer-admitted'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('propagates a fatal leader push from the graceful drain', (test) =>
    Effect.gen(function* () {
      const pushStarted = yield* Deferred.make<void>()
      const failPush = yield* Deferred.make<void>()
      const failure = new Error('leader push crashed')
      const { processor, pushIds, close } = yield* makeClientProcessorHarness({
        push: () =>
          Deferred.succeed(pushStarted, undefined).pipe(
            Effect.andThen(Deferred.await(failPush)),
            Effect.andThen(Effect.die(failure)),
          ),
      })

      yield* pushIds(['fatal'])
      yield* Deferred.await(pushStarted)

      const closeFiber = yield* close().pipe(Effect.exit, Effect.forkChild)
      yield* processor.debug.awaitDrainStarted
      yield* Deferred.succeed(failPush, undefined)
      const closeExit = yield* Fiber.join(closeFiber)

      expect(Exit.isFailure(closeExit)).toBe(true)
      Exit.match(closeExit, {
        onFailure: (cause) => expect(Cause.squash(cause)).toBe(failure),
        onSuccess: () => assert.fail('expected graceful drain to fail'),
      })
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('store shutdown timeout stops waiting without cancelling teardown', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const pushStarted = yield* Deferred.make<void>()
      const releasePush = yield* Deferred.make<void>()
      const pushCompleted = yield* Deferred.make<void>()
      const pushInterrupted = yield* Deferred.make<void>()

      const store = yield* makeStore({
        testing: {
          overrides: {
            clientSession: {
              leaderThreadProxy: (leader) => ({
                ...leader,
                events: {
                  ...leader.events,
                  push: () =>
                    Deferred.succeed(pushStarted, undefined).pipe(
                      Effect.andThen(Deferred.await(releasePush)),
                      Effect.andThen(Deferred.succeed(pushCompleted, undefined)),
                      Effect.onInterrupt(() => Deferred.succeed(pushInterrupted, undefined)),
                    ),
                },
              }),
            },
          },
        },
      })

      store.commit(events.todoCreated({ id: 'blocked', text: 'blocked', completed: false }))
      yield* Deferred.await(pushStarted)

      const shutdownFiber = yield* store.shutdown().pipe(Effect.forkChild)
      yield* TestClock.adjust(1000)
      yield* Fiber.join(shutdownFiber)

      expect(yield* Deferred.isDone(pushCompleted)).toBe(false)
      expect(yield* Deferred.isDone(pushInterrupted)).toBe(false)

      yield* Deferred.succeed(releasePush, undefined)
      yield* Deferred.await(pushCompleted)
    }).pipe(withTestCtx(test)),
  )

  /**
   * Regression guard for https://github.com/livestorejs/livestore/issues/744:
   * `ClientSessionSyncProcessor.push` must carry the current rebase generation into both
   * the child and parent sequence numbers after the leader forces a rebase.
   * Without the carry-forward logic in `EventSequenceNumber.nextPair`, the generation would reset,
   * masking stale pushes and reintroducing the queue leak described in the issue.
   */
  Vitest.live('rebased pushes carry rebase generation forward', (test) =>
    Effect.gen(function* () {
      const lockStatus = yield* SubscriptionRef.make<LockStatus>('has-lock')

      const baseHead = EventSequenceNumber.Client.Composite.make({ global: 10, client: 0, rebaseGeneration: 4 })
      const recordedEvents: LiveStoreEvent.Client.EncodedWithMeta[] = []

      const leaderThread: ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy = {
        events: {
          pull: () => Stream.empty,
          push: () => Effect.void,
          stream: () => Stream.empty,
        },
        initialState: {
          leaderHead: baseHead,
          migrationsReport: { migrations: [] },
          storageMode: 'persisted',
        },
        export: Effect.die(new Error('not implemented')),
        getEventlogData: Effect.die(new Error('not implemented')),
        syncState: Subscribable.make({
          get: Effect.die(new Error('not implemented')),
          changes: Stream.empty,
        }),
        sendDevtoolsMessage: () => Effect.void,
        networkStatus: Subscribable.make({
          get: Effect.die(new Error('not implemented')),
          changes: Stream.empty,
        }),
      }

      const clientSession: ClientSession = {
        sqliteDb: {} as any,
        devtools: { enabled: false },
        clientId: 'client-test',
        sessionId: 'session-test',
        lockStatus,
        shutdown: () => Effect.void,
        leaderThread,
        debugInstanceId: 'test-instance',
      }

      const syncProcessor = yield* makeClientSessionSyncProcessor({
        schema: schema as LiveStoreSchema,
        clientSession,
        materializeEvent: (event) =>
          Effect.sync(() => {
            recordedEvents.push(event)
          }).pipe(
            Effect.as({
              writeTables: new Set<string>(),
              sessionChangeset: { _tag: 'no-op' as const },
              materializerHash: Option.none<number>(),
            }),
          ),
        rollback: () => undefined,
        refreshTables: () => undefined,

        params: { leaderPushBatchSize: 10 },
        confirmUnsavedChanges: false,
      }).pipe(Effect.provide(StateHead.layerTest))

      const encoded = yield* syncProcessor.encodeEvents([
        events.todoCreated({ id: 'post-rebase', text: 'after', completed: false }),
      ])
      yield* syncProcessor.materializeEvents(encoded)
      yield* syncProcessor.push(encoded)

      expect(recordedEvents).toHaveLength(1)
      const event = recordedEvents[0]!
      expect(event.seqNum).toEqual(
        EventSequenceNumber.Client.Composite.make({ global: 11, client: 0, rebaseGeneration: 4 }),
      )
      expect(event.seqNum.rebaseGeneration).toBe(baseHead.rebaseGeneration)
      expect(event.parentSeqNum.rebaseGeneration).toBe(baseHead.rebaseGeneration)
    }).pipe(withTestCtx(test)),
  )

  // In cases where the materializer is non-pure (e.g. for events.todoDeletedNonPure calling `new Date()`),
  // the ClientSessionSyncProcessor will fail gracefully when detecting a materializer hash mismatch.
  // This covers the leader-side hash mismatch detection, which occurs during the push path (when sending events to the leader)
  Vitest.live('should fail gracefully if materializer is side effecting', (test) =>
    Effect.gen(function* () {
      const { makeStore, shutdownDeferred } = yield* TestContext
      const store = yield* makeStore()

      store.commit(events.todoDeletedNonPure({ id: '1' }))

      const error = yield* Deferred.await(shutdownDeferred).pipe(Effect.flip)

      expect(error._tag).toEqual('MaterializeError')
    }).pipe(withTestCtx(test)),
  )

  // This test covers the client-session-side hash mismatch detection, which occurs during the pull path (when receiving events from the leader).
  Vitest.live('should fail gracefully if client-session-side materializer hash mismatch is detected', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<LiveStoreEvent.Client.EncodedWithMeta>()

      const { makeStore, shutdownDeferred } = yield* TestContext

      yield* makeStore({
        testing: {
          overrides: {
            clientSession: {
              leaderThreadProxy: () => ({
                events: {
                  pull: () =>
                    Stream.fromQueue(pullQueue).pipe(
                      Stream.map((item) => ({
                        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [item] }),
                      })),
                    ),
                  push: () => Effect.void,
                  stream: () => Stream.empty,
                },
              }),
            },
          },
        },
      })

      const eventSchema = LiveStoreEvent.Input.makeSchema(schema)

      // Create an event that comes from the leader with a specific hash that won't match the client-side materializer's computed hash.
      const eventFromLeader = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...(yield* Schema.encodeEffect(eventSchema)(
          events.todoCreated({ id: 'test-id', text: 'from-leader', completed: false }),
        )),
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 0, client: 1 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'this-client',
        sessionId: 'static-session-id',
        meta: {
          sessionChangeset: { _tag: 'no-op' } as const,
          syncMetadata: Option.none(),
          materializerHashSession: Option.none(),
          // Set a leader hash that won't match what our non-deterministic materializer computes
          materializerHashLeader: Option.some(99), // This hash will not match the computed hash
        },
      })

      // Send the event from the leader to trigger the pull path
      yield* Queue.offer(pullQueue, eventFromLeader)

      // Wait for the shutdown to be triggered by the client-side hash mismatch detection
      const error = yield* Deferred.await(shutdownDeferred).pipe(Effect.flip)

      expect(error._tag).toEqual('MaterializeError')
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('unknown upstream events still invoke materializeEvent', (test) =>
    Effect.gen(function* () {
      const upstreamQueue = yield* Queue.unbounded<LiveStoreEvent.Client.EncodedWithMeta>()
      const materializedEvents: LiveStoreEvent.Client.EncodedWithMeta[] = []

      const lockStatus = yield* SubscriptionRef.make<'has-lock' | 'no-lock'>('has-lock')

      const networkStatus = Subscribable.make<SyncBackend.NetworkStatus, never, never>({
        get: Effect.succeed({
          isConnected: true,
          timestampMs: 0,
          devtools: { latchClosed: false },
        }),
        changes: Stream.fromIterable([] as ReadonlyArray<SyncBackend.NetworkStatus>),
      })

      const materializeEvent = Effect.fn('test:materialize-event')(
        (event: LiveStoreEvent.Client.EncodedWithMeta, _options: { materializerHashLeader: Option.Option<number> }) =>
          Effect.gen(function* () {
            materializedEvents.push(event)
            return {
              writeTables: new Set<string>(),
              sessionChangeset: { _tag: 'no-op' as const },
              materializerHash: Option.none<number>(),
            }
          }),
      )

      const clientSession = {
        sqliteDb: {} as ClientSession['sqliteDb'],
        devtools: { enabled: false } as ClientSession['devtools'],
        clientId: 'client-test',
        sessionId: 'session-test',
        lockStatus,
        shutdown: () => Effect.void,
        leaderThread: {
          initialState: {
            leaderHead: EventSequenceNumber.Client.ROOT,
            migrationsReport: { migrations: [] },
            storageMode: 'persisted',
          },
          events: {
            push: () => Effect.void,
            pull: () =>
              Stream.fromQueue(upstreamQueue).pipe(
                Stream.map((event) => ({
                  payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [event] }),
                })),
              ),
            stream: () => Stream.empty,
          },
          export: Effect.die(new Error('not used')),
          getEventlogData: Effect.die(new Error('not used')),
          syncState: Subscribable.make({
            get: Effect.die(new Error('not used')),
            changes: Stream.never,
          }),
          sendDevtoolsMessage: () => Effect.die(new Error('not used')),
          networkStatus,
        },
        debugInstanceId: 'test-instance',
      } satisfies ClientSession

      const syncProcessor = yield* makeClientSessionSyncProcessor({
        schema: schema as LiveStoreSchema,
        clientSession,
        materializeEvent,
        rollback: () => undefined,
        refreshTables: () => undefined,

        params: { leaderPushBatchSize: 10 },
        confirmUnsavedChanges: false,
      }).pipe(Effect.provide(StateHead.layerTest))

      const unknownEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        name: 'unknown_event_test',
        args: { foo: 'bar' },
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* syncProcessor.boot
          const processed = yield* syncProcessor.syncState.changes.pipe(
            Stream.filter((state) => state.localHead.global === 1),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped,
          )

          yield* Queue.offer(upstreamQueue, unknownEvent)
          yield* Fiber.join(processed)
        }),
      )

      expect(materializedEvents).toHaveLength(1)
      expect(materializedEvents[0]?.name).toEqual('unknown_event_test')
      expect(materializedEvents[0]?.meta.sessionChangeset._tag).toEqual('no-op')
    }).pipe(withTestCtx(test)),
  )

  Vitest.live('push fiber triggers shutdown on non-RejectedPushError', (test) =>
    Effect.gen(function* () {
      const pushError = new Error('unexpected transport failure')

      const { makeStore, shutdownDeferred } = yield* TestContext

      const store = yield* makeStore({
        testing: {
          overrides: {
            clientSession: {
              leaderThreadProxy: (leader) => ({
                events: {
                  pull: leader.events.pull,
                  push: () => Effect.die(pushError),
                  stream: leader.events.stream,
                },
              }),
            },
          },
        },
      })

      store.commit(events.todoCreated({ id: 'trigger', text: 'boom', completed: false }))

      const exit = yield* Effect.exit(Deferred.await(shutdownDeferred))

      expect(Exit.isFailure(exit)).toBe(true)
      assert(Exit.isFailure(exit))

      const defect = Cause.findDefect(exit.cause)
      expect(Result.isSuccess(defect)).toBe(true)
      assert(Result.isSuccess(defect))
      expect(defect.success).toBeInstanceOf(Error)
      assert(defect.success instanceof Error)
      expect(defect.success.message).toBe('unexpected transport failure')
    }).pipe(withTestCtx(test)),
  )

  // TODO write tests for:
  // - leader re-election
})

class TestContext extends Context.Service<
  TestContext,
  {
    makeStore: (args?: {
      boot?: (store: Store) => void
      testing?: {
        overrides?: {
          clientSession?: {
            leaderThreadProxy?: (
              original: ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy,
            ) => Partial<ClientSessionLeaderThreadProxy.ClientSessionLeaderThreadProxy>
          }
        }
      }
    }) => Effect.Effect<Store, UnknownError, Scope.Scope | OtelTracer.OtelTracer>
    mockSyncBackend: MockSyncBackend
    shutdownDeferred: ShutdownDeferred
  }
>()('TestContext') {}

const TestContextLive = Layer.effect(
  TestContext,
  Effect.gen(function* () {
    const mockSyncBackend = yield* makeMockSyncBackend()
    const shutdownDeferred = yield* makeShutdownDeferred

    const makeStore: typeof TestContext.Service.makeStore = (args) => {
      const adapter = makeTestAdapter({
        sync: { backend: () => mockSyncBackend.makeSyncBackend, onSyncError: 'shutdown' },
        ...omitUndefineds({ testing: args?.testing }),
      })
      return createStore({
        schema: schema as LiveStoreSchema,
        adapter,
        storeId: nanoid(),
        shutdownDeferred,
        ...omitUndefineds({ boot: args?.boot }),
      })
    }

    return { makeStore, mockSyncBackend, shutdownDeferred }
  }),
)
