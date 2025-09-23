import { makeAdapter } from '@livestore/adapter-node'
import type { MockSyncBackend } from '@livestore/common'
import {
  type BootStatus,
  type ClientSessionLeaderThreadProxy,
  makeMockSyncBackend,
  SyncState,
  type UnexpectedError,
} from '@livestore/common'
import { Eventlog, makeMaterializeEvent, recreateDb } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import type { MakeNodeSqliteDb } from '@livestore/sqlite-wasm/node'
import { omitUndefineds } from '@livestore/utils'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import {
  Context,
  Effect,
  FetchHttpClient,
  Layer,
  Logger,
  LogLevel,
  Option,
  Queue,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { events, schema, tables } from '../leader-thread/fixture.ts'

// TODO fix type level - derived events are missing and thus infers to `never` currently
const eventSchema = LiveStoreEvent.makeEventDefPartialSchema(
  schema,
) as TODO as Schema.Schema<LiveStoreEvent.PartialAnyEncoded>
const encode = Schema.encodeSync(eventSchema)

const withTestCtx = Vitest.makeWithTestCtx({
  makeLayer: () =>
    Layer.mergeAll(
      TestContextLive,
      PlatformNode.NodeFileSystem.layer,
      FetchHttpClient.layer,
      Logger.minimumLogLevel(LogLevel.Debug),
    ),
})

// TODO use property tests for simulation params
Vitest.describe.concurrent('ClientSessionSyncProcessor', () => {
  Vitest.scopedLive('from scratch', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()

      store.commit(events.todoCreated({ id: '1', text: 't1', completed: false }))

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)
    }).pipe(withTestCtx(test)),
  )

  // TODO also add a test where there's a merge conflict in the leader <> backend
  Vitest.scopedLive('commits during boot', (test) =>
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
      yield* store.syncProcessor.syncState.changes.pipe(
        Stream.filter((_) => _.pending.length === 0),
        Stream.take(1),
        Stream.runDrain,
      )
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('sync backend is ahead', (test) =>
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

  Vitest.scopedLive('race condition between client session and sync backend', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      const store = yield* makeStore()

      for (let i = 0; i < 5; i++) {
        yield* mockSyncBackend
          .advance(eventFactory.todoCreated.next({ id: `backend_${i}`, text: '', completed: false }))
          .pipe(Effect.fork)
      }

      for (let i = 0; i < 5; i++) {
        store.commit(events.todoCreated({ id: `local_${i}`, text: '', completed: false }))
      }

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(5), Stream.runDrain)
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should fail for event that is not larger than expected upstream', (test) =>
    Effect.gen(function* () {
      const shutdownDeferred = yield* makeShutdownDeferred
      const pullQueue = yield* Queue.unbounded<LiveStoreEvent.EncodedWithMeta>()

      const adapter = makeAdapter({
        storage: { type: 'in-memory' },
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

      const eventSchema = LiveStoreEvent.makeEventDefPartialSchema(
        schema,
      ) as TODO as Schema.Schema<LiveStoreEvent.PartialAnyEncoded>
      const encode = Schema.encodeSync(eventSchema)

      yield* Queue.offer(
        pullQueue,
        LiveStoreEvent.EncodedWithMeta.make({
          ...encode(events.todoCreated({ id: `id_0`, text: '', completed: false })),
          seqNum: EventSequenceNumber.make({ global: 1, client: 0 }),
          parentSeqNum: EventSequenceNumber.ROOT,
          clientId: 'other-client',
          sessionId: 'static-session-id',
        }),
      ).pipe(Effect.repeatN(1))

      const error = yield* shutdownDeferred.pipe(Effect.flip)

      expect(error._tag).toEqual('LiveStore.UnexpectedError')
      expect(error.cause).toEqual(
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
  Vitest.scopedLive('client should push pending persisted events on start', (test) =>
    Effect.gen(function* () {
      const { mockSyncBackend } = yield* TestContext
      const shutdownDeferred = yield* makeShutdownDeferred

      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'other-client-session1'),
      })

      yield* mockSyncBackend.advance(eventFactory.todoCreated.next({ id: `backend_0`, text: 't2', completed: false }))

      const makeLeaderThread = yield* Effect.cachedFunction(
        Effect.fn(function* (makeSqliteDb: MakeNodeSqliteDb) {
          const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

          yield* Eventlog.initEventlogDb(dbEventlog)

          yield* Eventlog.insertIntoEventlog(
            LiveStoreEvent.EncodedWithMeta.make({
              ...encode(events.todoCreated({ id: `client_0`, text: 't1', completed: false })),
              clientId: 'client',
              seqNum: EventSequenceNumber.make({ global: 1, client: 0 }),
              parentSeqNum: EventSequenceNumber.ROOT,
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
        }, Effect.orDie),
        () => true, // always cache
      )

      const adapter = makeAdapter({
        storage: { type: 'in-memory' },
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
      // Wait for the client session to have reached e2
      yield* store.syncProcessor.syncState.changes.pipe(
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

  // In cases where the materializer is non-pure (e.g. for events.todoDeletedNonPure calling `new Date()`),
  // the ClientSessionSyncProcessor will fail gracefully when detecting a materializer hash mismatch.
  // This covers the leader-side hash mismatch detection, which occurs during the push path (when sending events to the leader)
  Vitest.scopedLive('should fail gracefully if materializer is side effecting', (test) =>
    Effect.gen(function* () {
      const { makeStore, shutdownDeferred } = yield* TestContext
      const store = yield* makeStore()

      store.commit(events.todoDeletedNonPure({ id: '1' }))

      const error = yield* shutdownDeferred.pipe(Effect.flip)

      expect(error._tag).toEqual('LiveStore.MaterializeError')
    }).pipe(withTestCtx(test)),
  )

  // This test covers the client-session-side hash mismatch detection, which occurs during the pull path (when receiving events from the leader).
  Vitest.scopedLive('should fail gracefully if client-session-side materializer hash mismatch is detected', (test) =>
    Effect.gen(function* () {
      const pullQueue = yield* Queue.unbounded<LiveStoreEvent.EncodedWithMeta>()

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
                },
              }),
            },
          },
        },
      })

      const eventSchema = LiveStoreEvent.makeEventDefPartialSchema(schema)
      const encode = Schema.encodeSync(eventSchema)

      // Create an event that comes from the leader with a specific hash that won't match the client-side materializer's computed hash.
      const eventFromLeader = LiveStoreEvent.EncodedWithMeta.make({
        ...encode(events.todoCreated({ id: 'test-id', text: 'from-leader', completed: false })),
        seqNum: EventSequenceNumber.make({ global: 0, client: 1 }),
        parentSeqNum: EventSequenceNumber.ROOT,
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
      const error = yield* shutdownDeferred.pipe(Effect.flip)

      expect(error._tag).toEqual('LiveStore.MaterializeError')
    }).pipe(withTestCtx(test)),
  )

  // TODO write tests for:
  // - leader re-election
})

class TestContext extends Context.Tag('TestContext')<
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
    }) => Effect.Effect<Store, UnexpectedError, Scope.Scope | OtelTracer.OtelTracer>
    mockSyncBackend: MockSyncBackend
    shutdownDeferred: ShutdownDeferred
  }
>() {}

const TestContextLive = Layer.scoped(
  TestContext,
  Effect.gen(function* () {
    const mockSyncBackend = yield* makeMockSyncBackend()
    const shutdownDeferred = yield* makeShutdownDeferred

    const makeStore: typeof TestContext.Service.makeStore = (args) => {
      const adapter = makeAdapter({
        storage: { type: 'in-memory' },
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
