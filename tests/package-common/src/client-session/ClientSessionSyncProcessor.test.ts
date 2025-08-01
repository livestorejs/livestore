import { makeAdapter } from '@livestore/adapter-node'
import {
  type BootStatus,
  type ClientSessionLeaderThreadProxy,
  SyncState,
  type UnexpectedError,
} from '@livestore/common'
import { Eventlog, makeMaterializeEvent, recreateDb } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import type { MakeNodeSqliteDb } from '@livestore/sqlite-wasm/node'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Effect, FetchHttpClient, Layer, Queue, Schema, Stream } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { events, schema, tables } from '../leader-thread/fixture.ts'
import type { MockSyncBackend } from '../mock-sync-backend.ts'
import { makeMockSyncBackend } from '../mock-sync-backend.ts'

// TODO fix type level - derived events are missing and thus infers to `never` currently
const eventSchema = LiveStoreEvent.makeEventDefPartialSchema(
  schema,
) as TODO as Schema.Schema<LiveStoreEvent.PartialAnyEncoded>
const encode = Schema.encodeSync(eventSchema)

const withTestCtx = Vitest.makeWithTestCtx({
  makeLayer: () => Layer.mergeAll(TestContextLive, PlatformNode.NodeFileSystem.layer, FetchHttpClient.layer),
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
      const encoded = encode(events.todoCreated({ id: '1', text: 't1', completed: false }))

      const store = yield* makeStore()

      store.commit(events.todoCreated({ id: '2', text: 't2', completed: false }))

      yield* mockSyncBackend.advance({
        ...encoded,
        seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
        parentSeqNum: EventSequenceNumber.ROOT.global,
        clientId: 'other-client',
        sessionId: 'static-session-id',
      })

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('race condition between client session and sync backend', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext

      const store = yield* makeStore()

      for (let i = 0; i < 5; i++) {
        yield* mockSyncBackend
          .advance({
            ...encode(events.todoCreated({ id: `backend_${i}`, text: '', completed: false })),
            seqNum: EventSequenceNumber.globalEventSequenceNumber(i + 1),
            parentSeqNum: EventSequenceNumber.globalEventSequenceNumber(i),
            clientId: 'other-client',
            sessionId: 'static-session-id',
          })
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

      const exit = yield* shutdownDeferred.pipe(Effect.flip)

      expect(exit._tag).toEqual('LiveStore.SyncError')
      expect(exit.cause).toEqual(
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

      yield* mockSyncBackend.advance(
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...encode(events.todoCreated({ id: `backend_0`, text: 't2', completed: false })),
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
          clientId: 'other-client',
          sessionId: 'other-client-session1',
        }),
      )

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
            0, // unused mutation def schema hash
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

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)

      const res = store.query(tables.todos.orderBy('text', 'asc'))

      expect(res).toMatchObject([
        { id: 'client_0', text: 't1', completed: false },
        { id: 'backend_0', text: 't2', completed: false },
      ])
    }).pipe(withTestCtx(test)),
  )

  // In cases where the materializer is non-pure (e.g. for events.todoDeletedNonPure calling `new Date()`),
  // the ClientSessionSyncProcessor will fail gracefully when detecting a materializer hash mismatch.
  Vitest.scopedLive('should fail gracefully if materializer is side effecting', (test) =>
    Effect.gen(function* () {
      const { makeStore, shutdownDeferred } = yield* TestContext
      const store = yield* makeStore()

      store.commit(events.todoDeletedNonPure({ id: '1' }))

      const error = yield* shutdownDeferred.pipe(Effect.flip)

      expect(error._tag).toEqual('LiveStore.UnexpectedError')
      expect(error.cause).includes('Materializer hash mismatch detected for event')
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
    const mockSyncBackend = yield* makeMockSyncBackend
    const shutdownDeferred = yield* makeShutdownDeferred

    const makeStore: typeof TestContext.Service.makeStore = (args) => {
      const adapter = makeAdapter({
        storage: { type: 'in-memory' },
        sync: { backend: () => mockSyncBackend.makeSyncBackend, onSyncError: 'shutdown' },
        testing: args?.testing,
      })
      return createStore({
        schema: schema as LiveStoreSchema,
        adapter,
        storeId: nanoid(),
        shutdownDeferred,
        boot: args?.boot,
      })
    }

    return { makeStore, mockSyncBackend, shutdownDeferred }
  }),
)
