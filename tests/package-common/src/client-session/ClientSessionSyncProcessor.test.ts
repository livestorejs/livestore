import { assert, expect } from 'vitest'

import type { LockStatus, MockSyncBackend } from '@livestore/common'
import {
  type BootStatus,
  type ClientSession,
  type ClientSessionLeaderThreadProxy,
  LeaderAheadError,
  makeMockSyncBackend,
  SyncState,
  UnknownError,
} from '@livestore/common'
import { Eventlog, makeMaterializeEvent, recreateDb } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { makeClientSessionSyncProcessor, type SyncBackend } from '@livestore/common/sync'
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
  Layer,
  Logger,
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
  materializeEvent,
  shutdown = () => Effect.void,
  leaderPushBatchSize = 1,
  simulation,
}: {
  push: LeaderEvents['push']
  pull?: LeaderEvents['pull']
  rollback?: (changeset: Uint8Array<ArrayBuffer>) => void
  materializeEvent?: ClientProcessorParams['materializeEvent']
  shutdown?: ClientSession['shutdown']
  leaderPushBatchSize?: number
  simulation?: ClientProcessorParams['params']['simulation']
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
    devtools: { enabled: false },
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
    materializeEvent:
      materializeEvent ??
      (() =>
        Effect.succeed({
          writeTables: new Set<string>(),
          sessionChangeset: { _tag: 'no-op' as const },
          materializerHash: Option.none<number>(),
        })),
    rollback,
    refreshTables: () => undefined,
    params: { leaderPushBatchSize, simulation },
    confirmUnsavedChanges: false,
  })

  const scope = yield* Scope.make()
  yield* processor.boot.pipe(Scope.provide(scope))

  const pushIds = Effect.fn(function* (ids: ReadonlyArray<string>) {
    const encoded = yield* processor.encodeEvents(
      ids.map((id) => events.todoCreated({ id, text: id, completed: false })),
    )
    yield* processor.push(encoded)
    return encoded
  })

  return { processor, pushIds, scope }
})

// TODO use property tests for simulation params
Vitest.describe.concurrent('ClientSessionSyncProcessor', () => {
  Vitest.live('from scratch', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()

      store.commit(events.todoCreated({ id: '1', text: 't1', completed: false }))

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)
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
            const materializeEvent = yield* makeMaterializeEvent({ schema, dbState, dbEventlog })
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
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('drains in-flight and queued leader pushes serially on shutdown', (test) =>
    Effect.gen(function* () {
      const firstPushStarted = yield* Deferred.make<void>()
      const persistedBatches: ReadonlyArray<LiveStoreEvent.Client.Encoded>[] = []
      let isFirstPush = true
      let activePushCount = 0
      let maxActivePushCount = 0

      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        push: (batch) =>
          Effect.gen(function* () {
            activePushCount++
            maxActivePushCount = Math.max(maxActivePushCount, activePushCount)

            if (isFirstPush === true) {
              isFirstPush = false
              yield* Deferred.succeed(firstPushStarted, undefined)
              yield* Effect.sleep('1 millis')
            }

            persistedBatches.push(batch)
            activePushCount--
          }),
      })

      yield* pushIds(['first'])
      yield* Deferred.await(firstPushStarted)
      yield* pushIds(['second'])
      yield* pushIds(['third'])

      // Close election happens before advancing the virtual clock that releases the in-flight push.
      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* processor.debug.awaitClosing
      yield* TestClock.adjust('1 millis')
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

        const { pushIds, scope } = yield* makeClientProcessorHarness({
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

        yield* Scope.close(scope, Exit.void)

        expect(persistedBatches.flatMap((batch) => batch.map((event) => event.args.id))).toEqual(expectedIds)
        expect(persistedBatches.every((batch) => batch.length > 0 && batch.length <= leaderPushBatchSize)).toBe(true)
      }).pipe(withTestCtx(test)),
    { fastCheck: { numRuns: 50 } },
  )

  Vitest.asProp(
    Vitest.live,
    'preserves pending FIFO across repeated completed rebase replacements',
    [
      FastCheck.integer({ min: 1, max: 5 }),
      FastCheck.array(FastCheck.array(FastCheck.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 4 }), {
        minLength: 1,
        maxLength: 3,
      }),
    ] as const,
    ([leaderPushBatchSize, epochPushGroups], test) =>
      Effect.gen(function* () {
        type Attempt = {
          readonly batch: ReadonlyArray<LiveStoreEvent.Client.Encoded>
          readonly release: Deferred.Deferred<void>
          readonly settled: Deferred.Deferred<Exit.Exit<void>>
        }

        const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
        const attempts = yield* Queue.unbounded<Attempt>()
        let activePushCount = 0
        let maxActivePushCount = 0

        const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
          leaderPushBatchSize,
          pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
          push: (batch) =>
            Effect.gen(function* () {
              const release = yield* Deferred.make<void>()
              const settled = yield* Deferred.make<Exit.Exit<void>>()
              activePushCount++
              maxActivePushCount = Math.max(maxActivePushCount, activePushCount)
              yield* Queue.offer(attempts, { batch, release, settled })

              yield* Deferred.await(release).pipe(
                Effect.onExit((exit) =>
                  Effect.sync(() => {
                    activePushCount--
                  }).pipe(Effect.andThen(Deferred.succeed(settled, exit))),
                ),
              )
            }),
        })
        let scopeClosed = false
        yield* Effect.addFinalizer(() =>
          scopeClosed === true ? Effect.void : Scope.close(scope, Exit.fail(new Error('property run cleanup'))),
        )

        const expectedIds: string[] = []
        const offerGroups = Effect.fnUntraced(function* (pushGroupSizes: ReadonlyArray<number>) {
          for (const groupSize of pushGroupSizes) {
            const groupIds = Array.from({ length: groupSize }, (_, index) => `event-${expectedIds.length + index}`)
            expectedIds.push(...groupIds)
            yield* pushIds(groupIds)
          }
        })

        yield* offerGroups(epochPushGroups[0]!)
        let currentAttempt = yield* Queue.take(attempts)

        for (const [epochIndex, pushGroupSizes] of epochPushGroups.entries()) {
          if (epochIndex > 0) yield* offerGroups(pushGroupSizes)

          // Taking the attempt is the explicit happens-before edge proving that the old epoch owns a batch.
          // The upstream advance then forces rebase to interrupt that owner and reconstruct its queue from pending.
          const global = epochIndex + 1
          const [remoteBase] = yield* processor.encodeEvents([
            events.todoCreated({ id: `remote-${global}`, text: `remote-${global}`, completed: false }),
          ])
          yield* Queue.offer(
            pullQueue,
            SyncState.PayloadUpstreamAdvance.make({
              newEvents: [
                LiveStoreEvent.Client.EncodedWithMeta.make({
                  ...remoteBase!,
                  seqNum: EventSequenceNumber.Client.Composite.make({ global, client: 0 }),
                  parentSeqNum:
                    global === 1
                      ? EventSequenceNumber.Client.ROOT
                      : EventSequenceNumber.Client.Composite.make({ global: global - 1, client: 0 }),
                  clientId: 'remote-client',
                  sessionId: 'remote-session',
                }),
              ],
            }),
          )

          const replacedExit = yield* Deferred.await(currentAttempt.settled)
          expect(Exit.isFailure(replacedExit)).toBe(true)
          assert(Exit.isFailure(replacedExit))
          expect(Cause.hasInterruptsOnly(replacedExit.cause)).toBe(true)

          // The successor can only call the fake leader after pending has been projected and its worker published.
          // Carry that attempt into the next command instead of depending on scheduler progress between commands.
          currentAttempt = yield* Queue.take(attempts)
          const stateAfterReplacement = yield* processor.syncState.get
          expect(stateAfterReplacement.pending.map((event) => event.args.id)).toEqual(expectedIds)
        }

        const acceptedIds: string[] = []
        let nextAttempt: Attempt | undefined = currentAttempt
        while (acceptedIds.length < expectedIds.length) {
          const attempt = nextAttempt ?? (yield* Queue.take(attempts))
          nextAttempt = undefined
          const attemptIds = attempt.batch.map((event) => event.args.id as string)
          expect(attemptIds).toEqual(expectedIds.slice(acceptedIds.length, acceptedIds.length + attemptIds.length))
          expect(attemptIds.length).toBeGreaterThan(0)
          expect(attemptIds.length).toBeLessThanOrEqual(leaderPushBatchSize)

          acceptedIds.push(...attemptIds)
          yield* Deferred.succeed(attempt.release, undefined)
          const attemptExit = yield* Deferred.await(attempt.settled)
          expect(Exit.isSuccess(attemptExit)).toBe(true)
        }

        yield* Scope.close(scope, Exit.void)
        scopeClosed = true

        expect(acceptedIds).toEqual(expectedIds)
        expect(new Set(acceptedIds).size).toBe(expectedIds.length)
        expect(maxActivePushCount).toBe(1)
      }).pipe(withTestCtx(test)),
    { fastCheck: { numRuns: 50 } },
  )

  Vitest.it.effect('finishes closing while upstream continuously produces empty payloads', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.bounded<typeof SyncState.PayloadUpstream.Type>(1)
      const backToBackPayloadsObserved = yield* Deferred.make<void>()
      const emptyPayload = SyncState.PayloadUpstreamAdvance.make({ newEvents: [] })
      let pullCount = 0

      const { processor, scope } = yield* makeClientProcessorHarness({
        push: () => Effect.void,
        pull: () =>
          Stream.fromQueue(pullQueue).pipe(
            Stream.map((payload) => {
              pullCount++
              if (pullCount === 2) Effect.runSync(Deferred.succeed(backToBackPayloadsObserved, undefined))
              return { payload }
            }),
          ),
      })

      const producer = yield* Queue.offer(pullQueue, emptyPayload).pipe(Effect.forever, Effect.forkChild)
      yield* Deferred.await(backToBackPayloadsObserved)

      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* processor.debug.awaitClosing
      yield* processor.debug.awaitPullAdmissionClosed
      yield* Fiber.join(closeFiber)
      yield* Fiber.interrupt(producer)

      expect(pullCount).toBeGreaterThanOrEqual(2)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('admits recovery pull for a successor after the previous epoch pull cutoff', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushCompleted = yield* Deferred.make<void>()
      const secondRejectionObserved = yield* Deferred.make<void>()
      const thirdPushCompleted = yield* Deferred.make<void>()
      const closeCompleted = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0

      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          if (pushCount === 1) return Deferred.succeed(firstPushCompleted, undefined)
          if (pushCount === 2) {
            return Effect.fail(rejection).pipe(
              Effect.onError(() => Deferred.succeed(secondRejectionObserved, undefined)),
            )
          }
          return Deferred.succeed(thirdPushCompleted, undefined)
        },
        simulation: { pull: { before_pull_handoff: 1 } },
      })

      yield* pushIds(['two-generation-recovery'])
      yield* Deferred.await(firstPushCompleted)
      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-two-generation', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })

      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))
      yield* processor.debug.awaitBeforePullHandoff
      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(
        Effect.ensuring(Deferred.succeed(closeCompleted, undefined)),
        Effect.forkChild,
      )
      yield* processor.debug.awaitClosing
      yield* processor.debug.awaitPullAdmissionClosed
      expect(yield* Deferred.isDone(closeCompleted)).toBe(false)

      // Complete P: it installs ended successor B after epoch A's cutoff; B's rejection then requires pull Q.
      yield* TestClock.adjust('1 millis')
      yield* Deferred.await(secondRejectionObserved)
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [] }))
      yield* processor.debug.awaitBeforePullHandoff
      yield* TestClock.adjust('1 millis')
      yield* Deferred.await(thirdPushCompleted)
      yield* Fiber.join(closeFiber)

      expect(pushCount).toBe(3)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('transfers a paused pull lease through revision-mismatch recovery', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushStarted = yield* Deferred.make<void>()
      const releaseRejection = yield* Deferred.make<void>()
      const successorPushCompleted = yield* Deferred.make<void>()
      const materializationStarted = yield* Deferred.make<void>()
      const releaseMaterialization = yield* Deferred.make<void>()
      const closeCompleted = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0

      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          return pushCount === 1
            ? Deferred.succeed(firstPushStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseRejection)),
                Effect.andThen(Effect.fail(rejection)),
              )
            : Deferred.succeed(successorPushCompleted, undefined)
        },
        materializeEvent: () =>
          Deferred.succeed(materializationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseMaterialization)),
            Effect.as({
              writeTables: new Set<string>(),
              sessionChangeset: { _tag: 'no-op' as const },
              materializerHash: Option.none<number>(),
            }),
          ),
        simulation: { pull: { before_pull_handoff: 1 } },
      })

      yield* pushIds(['revision-mismatch-lease'])
      yield* Deferred.await(firstPushStarted)
      // X advances the revision after the first push attempt captured it.
      yield* processor.syncState.changes.pipe(Stream.take(1), Stream.runDrain)
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [] }))
      yield* processor.debug.awaitBeforePullHandoff
      yield* TestClock.adjust('1 millis')
      yield* processor.syncState.changes.pipe(Stream.take(1), Stream.runDrain)

      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-paused-lease', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))
      yield* processor.debug.awaitBeforePullHandoff

      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(
        Effect.ensuring(Deferred.succeed(closeCompleted, undefined)),
        Effect.forkChild,
      )
      yield* processor.debug.awaitClosing
      yield* Deferred.succeed(releaseRejection, undefined)
      yield* Deferred.await(successorPushCompleted)
      yield* processor.debug.awaitPullAdmissionClosed
      expect(yield* Deferred.isDone(closeCompleted)).toBe(false)

      yield* TestClock.adjust('1 millis')
      yield* Deferred.await(materializationStarted)
      expect(yield* Deferred.isDone(closeCompleted)).toBe(false)
      yield* Deferred.succeed(releaseMaterialization, undefined)
      yield* Fiber.join(closeFiber)

      expect(pushCount).toBeGreaterThanOrEqual(2)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('admits a local push during rebase without losing it from the successor epoch', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const rebaseMaterializationStarted = yield* Deferred.make<void>()
      const releaseRebaseMaterialization = yield* Deferred.make<void>()
      const shutdownRequested = yield* Deferred.make<void>()
      const persistedIds: string[] = []
      let isFirstMaterialization = true

      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => {
          return Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload })))
        },
        push: (batch) =>
          Effect.sync(() => {
            persistedIds.push(...batch.map((event) => event.args.id as string))
          }),
        materializeEvent: () =>
          Effect.gen(function* () {
            if (isFirstMaterialization === true) {
              isFirstMaterialization = false
              yield* Deferred.succeed(rebaseMaterializationStarted, undefined)
              yield* Deferred.await(releaseRebaseMaterialization)
            }
            return {
              writeTables: new Set<string>(),
              sessionChangeset: { _tag: 'no-op' as const },
              materializerHash: Option.none<number>(),
            }
          }),
        shutdown: () => Deferred.succeed(shutdownRequested, undefined),
      })

      yield* pushIds(['before-rebase'])
      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-rebase-base', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))

      // The published rebase handoff happens-before materialization, so this push targets its successor epoch while
      // the pull fiber is still processing the rebase.
      yield* Deferred.await(rebaseMaterializationStarted)
      yield* pushIds(['during-rebase'])
      const pendingDuringRebase = yield* processor.syncState.get
      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* Deferred.succeed(releaseRebaseMaterialization, undefined)
      yield* Fiber.join(closeFiber)

      expect(persistedIds).toEqual(['before-rebase', 'before-rebase', 'during-rebase'])
      expect(pendingDuringRebase.pending.map((event) => event.args.id)).toEqual(['before-rebase', 'during-rebase'])
      expect(yield* Deferred.isDone(shutdownRequested)).toBe(false)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('interrupts a hung leader push during failed shutdown', (test) =>
    Effect.gen(function* () {
      const firstPushStarted = yield* Deferred.make<void>()
      const firstPushInterrupted = yield* Deferred.make<void>()
      const admissionAtInterrupt = yield* Deferred.make<Exit.Exit<void, unknown>>()
      let shutdownCalls = 0
      let captureAdmissionAtInterrupt: Effect.Effect<void> = Effect.die('processor not initialized')
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        shutdown: () =>
          Effect.sync(() => {
            shutdownCalls++
          }),
        push: () =>
          Deferred.succeed(firstPushStarted, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              captureAdmissionAtInterrupt.pipe(Effect.andThen(Deferred.succeed(firstPushInterrupted, undefined))),
            ),
          ),
      })
      captureAdmissionAtInterrupt = processor.push([]).pipe(
        Effect.exit,
        Effect.flatMap((exit) => Deferred.succeed(admissionAtInterrupt, exit)),
      )

      yield* pushIds(['blocked'])
      yield* Deferred.await(firstPushStarted)

      yield* Scope.close(scope, Exit.fail(new Error('test shutdown failure')))

      expect(yield* Deferred.isDone(firstPushInterrupted)).toBe(true)
      expect(Exit.isFailure(yield* Deferred.await(admissionAtInterrupt))).toBe(true)
      expect(shutdownCalls).toBe(0)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('fails a graceful drain when its in-flight leader push dies', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const pushStarted = yield* Deferred.make<void>()
      const releaseFailure = yield* Deferred.make<void>()
      const failure = new Error('leader push defect during close')
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        push: () =>
          Deferred.succeed(pushStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFailure)),
            Effect.andThen(Effect.die(failure)),
          ),
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        simulation: { pull: { before_pull_handoff: 1 } },
      })

      yield* pushIds(['fatal'])
      yield* Deferred.await(pushStarted)
      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-worker-fatal', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))
      yield* processor.debug.awaitBeforePullHandoff
      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.succeed(releaseFailure, undefined)
      yield* TestClock.adjust('1 millis')
      const closeExit = yield* Fiber.join(closeFiber)

      expect(Exit.isFailure(closeExit)).toBe(true)
      assert(Exit.isFailure(closeExit))
      expect(Cause.findDefect(closeExit.cause)).toEqual(Result.succeed(failure))
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('fails a graceful drain when rebase materialization dies after installing a successor', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const materializationStarted = yield* Deferred.make<void>()
      const failMaterialization = yield* Deferred.make<void>()
      const failure = new Error('pull defect during close')
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        push: () => Effect.void,
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        materializeEvent: () =>
          Deferred.succeed(materializationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(failMaterialization)),
            Effect.andThen(Effect.die(failure)),
          ),
      })

      yield* pushIds(['pending-before-pull-fatal'])
      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-pull-fatal', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      // Queue a completed payload immediately before the fatal materializing payload to exercise latch replacement.
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [] }))
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))
      yield* Deferred.await(materializationStarted)
      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.succeed(failMaterialization, undefined)
      const closeExit = yield* Fiber.join(closeFiber)

      expect(Exit.isFailure(closeExit)).toBe(true)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('stops processing buffered pull payloads after a fatal materialization', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstMaterializationStarted = yield* Deferred.make<void>()
      const failFirstMaterialization = yield* Deferred.make<void>()
      const secondMaterializationStarted = yield* Deferred.make<void>()
      const pullIterationEnded = yield* Deferred.make<void>()
      let materializationCount = 0

      const { processor, scope } = yield* makeClientProcessorHarness({
        push: () => Effect.void,
        pull: () =>
          Stream.fromQueue(pullQueue).pipe(
            Stream.take(2),
            Stream.map((payload) => ({ payload })),
            Stream.ensuring(Deferred.succeed(pullIterationEnded, undefined)),
          ),
        materializeEvent: () => {
          materializationCount++
          return materializationCount === 1
            ? Deferred.succeed(firstMaterializationStarted, undefined).pipe(
                Effect.andThen(Deferred.await(failFirstMaterialization)),
                Effect.andThen(Effect.die(new Error('first pull materialization failed'))),
              )
            : Deferred.succeed(secondMaterializationStarted, undefined).pipe(
                Effect.as({
                  writeTables: new Set<string>(),
                  sessionChangeset: { _tag: 'no-op' as const },
                  materializerHash: Option.none<number>(),
                }),
              )
        },
      })

      const [firstBase, secondBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-fatal-first', text: 'first', completed: false }),
        events.todoCreated({ id: 'remote-fatal-second', text: 'second', completed: false }),
      ])
      const firstEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...firstBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      const secondEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...secondBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 2, client: 0 }),
        parentSeqNum: firstEvent.seqNum,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })

      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [firstEvent] }))
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [secondEvent] }))
      yield* Deferred.await(firstMaterializationStarted)
      yield* Deferred.succeed(failFirstMaterialization, undefined)
      yield* Deferred.await(pullIterationEnded)

      expect(yield* Deferred.isDone(secondMaterializationStarted)).toBe(false)
      yield* Scope.close(scope, Exit.fail(new Error('test cleanup')))
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('keeps pull alive to rebase and retry a rejected shutdown drain', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const pushStarted = yield* Deferred.make<void>()
      const rejectPush = yield* Deferred.make<void>()
      const rejectionObserved = yield* Deferred.make<void>()
      const retryCompleted = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          return pushCount === 1
            ? Deferred.succeed(pushStarted, undefined).pipe(
                Effect.andThen(Deferred.await(rejectPush)),
                Effect.andThen(Effect.fail(rejection)),
                Effect.onError(() => Deferred.succeed(rejectionObserved, undefined)),
              )
            : Deferred.succeed(retryCompleted, undefined)
        },
      })

      yield* pushIds(['rejected'])
      yield* Deferred.await(pushStarted)

      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* Deferred.succeed(rejectPush, undefined)
      // Rejection completion happens-before publishing the leader advance that enables recovery.
      yield* Deferred.await(rejectionObserved)

      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-rejection-base', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))
      yield* Deferred.await(retryCompleted)
      yield* Fiber.join(closeFiber)

      expect(pushCount).toBe(2)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('does not finish a recovered drain before recovery pull materialization', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushStarted = yield* Deferred.make<void>()
      const releaseRejection = yield* Deferred.make<void>()
      const retryCompleted = yield* Deferred.make<void>()
      const materializationStarted = yield* Deferred.make<void>()
      const failMaterialization = yield* Deferred.make<void>()
      const closeCompleted = yield* Deferred.make<void>()
      const closeAdmissionObserved = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0
      let assertCloseAdmission: Effect.Effect<void> = Effect.die('processor not initialized')
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          return pushCount === 1
            ? Deferred.succeed(firstPushStarted, undefined).pipe(
                Effect.andThen(Effect.suspend(() => assertCloseAdmission)),
                Effect.andThen(Deferred.succeed(closeAdmissionObserved, undefined)),
                Effect.andThen(Deferred.await(releaseRejection)),
                Effect.andThen(Effect.fail(rejection)),
              )
            : Deferred.succeed(retryCompleted, undefined)
        },
        materializeEvent: () =>
          Deferred.succeed(materializationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(failMaterialization)),
            Effect.andThen(Effect.die(new Error('recovery materialization failed'))),
          ),
      })
      assertCloseAdmission = Effect.gen(function* () {
        yield* processor.debug.awaitClosing
        expect(Exit.isFailure(yield* processor.push([]).pipe(Effect.exit))).toBe(true)
      })

      yield* pushIds(['recovery-fatal'])
      yield* Deferred.await(firstPushStarted)
      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(
        Effect.exit,
        Effect.ensuring(Deferred.succeed(closeCompleted, undefined)),
        Effect.forkChild,
      )
      yield* Deferred.await(closeAdmissionObserved)
      yield* Deferred.succeed(releaseRejection, undefined)

      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-recovery-fatal', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))
      yield* Deferred.await(retryCompleted)
      yield* Deferred.await(materializationStarted)
      expect(yield* Deferred.isDone(closeCompleted)).toBe(false)

      yield* Deferred.succeed(failMaterialization, undefined)
      const closeExit = yield* Fiber.join(closeFiber)
      expect(Exit.isFailure(closeExit)).toBe(true)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('retains pushes admitted while an open epoch awaits rebase recovery', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const releaseRejection = yield* Deferred.make<void>()
      const firstPushStarted = yield* Deferred.make<void>()
      const rejectionObserved = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      const retryIds: string[] = []
      let pushCount = 0
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: (batch) => {
          pushCount++
          return pushCount === 1
            ? Deferred.succeed(firstPushStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseRejection)),
                Effect.andThen(Effect.fail(rejection)),
                Effect.onError(() => Deferred.succeed(rejectionObserved, undefined)),
              )
            : Effect.sync(() => retryIds.push(...batch.map((event) => event.args.id as string)))
        },
      })

      yield* pushIds(['rejected-open'])
      yield* Deferred.await(firstPushStarted)
      yield* Deferred.succeed(releaseRejection, undefined)
      yield* Deferred.await(rejectionObserved)
      while (processor.debug.debugInfo().rejectCount === 0) {
        yield* Effect.sync(() => processor.debug.debugInfo().rejectCount)
      }
      expect(processor.debug.debugInfo().rejectCount).toBe(1)
      yield* pushIds(['admitted-awaiting'])

      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-awaiting-base', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))
      yield* Scope.close(scope, Exit.void)

      expect(retryIds).toEqual(['rejected-open', 'admitted-awaiting'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('clears a confirmed rejected prefix while newer admitted events remain pending', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const rejectionReturned = yield* Deferred.make<void>()
      const retryAccepted = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          return pushCount === 1
            ? Effect.fail(rejection).pipe(Effect.ensuring(Deferred.succeed(rejectionReturned, undefined)))
            : Deferred.succeed(retryAccepted, undefined).pipe(Effect.asVoid)
        },
      })

      const [rejectedEvent] = yield* pushIds(['rejected-prefix'])
      yield* Deferred.await(rejectionReturned)
      yield* pushIds(['newer-admitted'])

      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [rejectedEvent!] }))
      yield* Deferred.await(retryAccepted)
      yield* Scope.close(scope, Exit.void)

      expect(pushCount).toBe(2)
      expect((yield* processor.syncState.get).pending.map((event) => event.args.id)).toEqual(['newer-admitted'])
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('rebuilds from pull progress admitted after close but before rejection', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushStarted = yield* Deferred.make<void>()
      const closeAdmissionObserved = yield* Deferred.make<void>()
      const releaseRejection = yield* Deferred.make<void>()
      const retryCompleted = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0
      let assertCloseAdmission: Effect.Effect<void> = Effect.die('processor not initialized')
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          return pushCount === 1
            ? Deferred.succeed(firstPushStarted, undefined).pipe(
                Effect.andThen(Effect.suspend(() => assertCloseAdmission)),
                Effect.andThen(Deferred.succeed(closeAdmissionObserved, undefined)),
                Effect.andThen(Deferred.await(releaseRejection)),
                Effect.andThen(Effect.fail(rejection)),
              )
            : Deferred.succeed(retryCompleted, undefined)
        },
      })
      assertCloseAdmission = Effect.gen(function* () {
        yield* processor.debug.awaitClosing
        expect(Exit.isFailure(yield* processor.push([]).pipe(Effect.exit))).toBe(true)
      })

      yield* pushIds(['revision-race'])
      yield* Deferred.await(firstPushStarted)
      // Drain the local-push notification so the next observed update is causally tied to the upstream payload.
      yield* processor.syncState.changes.pipe(Stream.take(1), Stream.runDrain)
      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* Deferred.await(closeAdmissionObserved)

      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [] }))
      // The notification proves the close-time payload was consumed before the delayed rejection was released.
      yield* processor.syncState.changes.pipe(Stream.take(1), Stream.runDrain)
      yield* Deferred.succeed(releaseRejection, undefined)
      yield* Deferred.await(retryCompleted)
      yield* Fiber.join(closeFiber)

      expect(pushCount).toBe(2)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('ignores a delayed rejection from an epoch already replaced by rebase', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<typeof SyncState.PayloadUpstream.Type>()
      const firstPushStarted = yield* Deferred.make<void>()
      const enterUninterruptibleResponse = yield* Deferred.make<void>()
      const uninterruptibleResponseEntered = yield* Deferred.make<void>()
      const releaseStaleRejection = yield* Deferred.make<void>()
      const retryCompleted = yield* Deferred.make<void>()
      const shutdownRequested = yield* Deferred.make<void>()
      const rejection = new LeaderAheadError({
        minimumExpectedNum: EventSequenceNumber.Client.ROOT,
        providedNum: EventSequenceNumber.Client.ROOT,
        sessionId: 'session-test',
      })
      let pushCount = 0
      const { processor, pushIds, scope } = yield* makeClientProcessorHarness({
        pull: () => Stream.fromQueue(pullQueue).pipe(Stream.map((payload) => ({ payload }))),
        push: () => {
          pushCount++
          return pushCount === 1
            ? Deferred.succeed(firstPushStarted, undefined).pipe(
                Effect.andThen(Deferred.await(enterUninterruptibleResponse)),
                Effect.andThen(
                  Deferred.succeed(uninterruptibleResponseEntered, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseStaleRejection)),
                    Effect.andThen(Effect.fail(rejection)),
                    Effect.uninterruptible,
                  ),
                ),
              )
            : Deferred.succeed(retryCompleted, undefined)
        },
        shutdown: () => Deferred.succeed(shutdownRequested, undefined),
        simulation: { pull: { before_pull_handoff: 1 } },
      })

      const [localEvent] = yield* pushIds(['stale-attempt'])
      localEvent!.meta.sessionChangeset = {
        _tag: 'sessionChangeset',
        data: new Uint8Array([1]),
        debug: {},
      }
      yield* Deferred.await(firstPushStarted)
      yield* processor.syncState.changes.pipe(Stream.take(1), Stream.runDrain)
      yield* Deferred.succeed(enterUninterruptibleResponse, undefined)
      yield* Deferred.await(uninterruptibleResponseEntered)

      const [remoteBase] = yield* processor.encodeEvents([
        events.todoCreated({ id: 'remote-stale-base', text: 'remote', completed: false }),
      ])
      const remoteEvent = LiveStoreEvent.Client.EncodedWithMeta.make({
        ...remoteBase!,
        seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
        parentSeqNum: EventSequenceNumber.Client.ROOT,
        clientId: 'remote-client',
        sessionId: 'remote-session',
      })
      yield* Queue.offer(pullQueue, SyncState.PayloadUpstreamAdvance.make({ newEvents: [remoteEvent] }))
      yield* TestClock.adjust('1 millis')
      const stateAfterHandoff = yield* processor.syncState.get
      expect(EventSequenceNumber.Client.isEqual(stateAfterHandoff.upstreamHead, remoteEvent.seqNum)).toBe(true)
      yield* Deferred.succeed(releaseStaleRejection, undefined)
      yield* Deferred.await(retryCompleted)
      yield* Scope.close(scope, Exit.void)

      expect(pushCount).toBe(2)
      expect(yield* Deferred.isDone(shutdownRequested)).toBe(false)
    }).pipe(withTestCtx(test)),
  )

  Vitest.it.effect('store shutdown timeout stops waiting without cancelling teardown', (test) => {
    const logMessages: string[] = []

    return Effect.gen(function* () {
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

      const shutdownReturned = yield* Deferred.make<void>()
      const concurrentShutdownReturned = yield* Deferred.make<void>()
      const shutdownFiber = yield* store
        .shutdown()
        .pipe(Effect.ensuring(Deferred.succeed(shutdownReturned, undefined)), Effect.forkChild)
      const concurrentShutdownFiber = yield* store
        .shutdown()
        .pipe(Effect.ensuring(Deferred.succeed(concurrentShutdownReturned, undefined)), Effect.forkChild)

      // Half of the declared timeout is an observable boundary: both callers must still be joining one cleanup.
      yield* TestClock.adjust(500)
      expect(yield* Deferred.isDone(shutdownReturned)).toBe(false)
      expect(yield* Deferred.isDone(concurrentShutdownReturned)).toBe(false)
      expect(logMessages.some((message) => message.includes('shutdown cleanup completed successfully'))).toBe(false)

      yield* TestClock.adjust(500)
      yield* Fiber.join(shutdownFiber)
      yield* Fiber.join(concurrentShutdownFiber)

      expect(yield* Deferred.isDone(pushCompleted)).toBe(false)
      expect(yield* Deferred.isDone(pushInterrupted)).toBe(false)
      expect(logMessages.filter((message) => message.includes('cleanup is continuing in the background'))).toHaveLength(
        1,
      )
      expect(logMessages.some((message) => message.includes('shutdown cleanup completed successfully'))).toBe(false)

      yield* Deferred.succeed(releasePush, undefined)
      yield* Deferred.await(pushCompleted)
      yield* store.shutdown()

      expect(logMessages.filter((message) => message.includes('shutdown cleanup completed successfully'))).toHaveLength(
        1,
      )
    }).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ message }) => {
            const messages = Array.isArray(message) === true ? message : [message]
            logMessages.push(messages.map(String).join(' '))
          }),
        ]),
      ),
      withTestCtx(test),
    )
  })

  Vitest.it.effect('signals the elected successful exit when cleanup dies', (test) => {
    const logMessages: string[] = []

    return Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const shutdownDeferred = yield* makeShutdownDeferred
      const pushStarted = yield* Deferred.make<void>()
      const failPush = yield* Deferred.make<void>()
      const failure = new Error('shutdown cleanup defect')

      const store = yield* makeStore({
        shutdownDeferred,
        testing: {
          overrides: {
            clientSession: {
              leaderThreadProxy: (leader) => ({
                ...leader,
                events: {
                  ...leader.events,
                  push: () =>
                    Deferred.succeed(pushStarted, undefined).pipe(
                      Effect.andThen(Deferred.await(failPush)),
                      Effect.andThen(Effect.die(failure)),
                    ),
                },
              }),
            },
          },
        },
      })

      store.commit(events.todoCreated({ id: 'fatal', text: 'fatal', completed: false }))
      yield* Deferred.await(pushStarted)

      const electedShutdownFiber = yield* store.shutdown().pipe(Effect.exit, Effect.forkChild)
      // Crossing a declared fraction of the timeout establishes that the first caller has won and is awaiting cleanup.
      yield* TestClock.adjust(500)
      const laterFailure = new UnknownError({ cause: new Error('later shutdown failure') })
      const concurrentShutdownFiber = yield* store
        .shutdown(Cause.fail(laterFailure))
        .pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.succeed(failPush, undefined)

      expect(Exit.isFailure(yield* Fiber.join(electedShutdownFiber))).toBe(true)
      expect(Exit.isFailure(yield* Fiber.join(concurrentShutdownFiber))).toBe(true)
      expect(Exit.isSuccess(yield* Effect.exit(Deferred.await(shutdownDeferred)))).toBe(true)
      expect(logMessages.filter((message) => message.includes('shutdown cleanup failed'))).toHaveLength(1)
      expect(logMessages.some((message) => message.includes('cleanup completed successfully'))).toBe(false)
    }).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ message }) => {
            const messages = Array.isArray(message) === true ? message : [message]
            logMessages.push(messages.map(String).join(' '))
          }),
        ]),
      ),
      withTestCtx(test),
    )
  })

  Vitest.it.effect('records a failed exit when failed shutdown wins election', (test) =>
    Effect.gen(function* () {
      const { makeStore, shutdownDeferred } = yield* TestContext
      const store = yield* makeStore()
      const electedFailure = new UnknownError({ cause: new Error('elected shutdown failure') })

      yield* store.shutdown(Cause.fail(electedFailure))
      yield* store.shutdown()

      const notifiedError = yield* Deferred.await(shutdownDeferred).pipe(Effect.flip)
      expect(notifiedError).toBe(electedFailure)
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
      })

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
        (
          event: LiveStoreEvent.Client.EncodedWithMeta,
          _options: { withChangeset: boolean; materializerHashLeader: Option.Option<number> },
        ) =>
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
      })

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
      shutdownDeferred?: ShutdownDeferred
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
        shutdownDeferred: args?.shutdownDeferred ?? shutdownDeferred,
        ...omitUndefineds({ boot: args?.boot }),
      })
    }

    return { makeStore, mockSyncBackend, shutdownDeferred }
  }),
)
