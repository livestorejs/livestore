import '@livestore/utils-dev/node-vitest-polyfill'

import { makeAdapter } from '@livestore/adapter-node'
import { SyncState, type UnexpectedError } from '@livestore/common'
import { Eventlog } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import {
  Context,
  Effect,
  FetchHttpClient,
  Layer,
  Logger,
  LogLevel,
  Queue,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { OtelLiveDummy, PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { events, schema, tables } from '../leader-thread/fixture.js'
import type { MockSyncBackend } from '../mock-sync-backend.js'
import { makeMockSyncBackend } from '../mock-sync-backend.js'

// TODO fix type level - derived events are missing and thus infers to `never` currently
const eventSchema = LiveStoreEvent.makeEventDefPartialSchema(
  schema,
) as TODO as Schema.Schema<LiveStoreEvent.PartialAnyEncoded>
const encode = Schema.encodeSync(eventSchema)

Vitest.describe('ClientSessionSyncProcessor', () => {
  Vitest.scopedLive('from scratch', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore

      store.commit(events.todoCreated({ id: '1', text: 't1', completed: false }))

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('sync backend is ahead', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const encoded = encode(events.todoCreated({ id: '1', text: 't1', completed: false }))

      const store = yield* makeStore

      store.commit(events.todoCreated({ id: '2', text: 't2', completed: false }))

      yield* mockSyncBackend.advance({
        ...encoded,
        seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
        parentSeqNum: EventSequenceNumber.ROOT.global,
        clientId: 'other-client',
        sessionId: 'static-session-id',
      })

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('race condition between client session and sync backend', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext

      const store = yield* makeStore

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
    }).pipe(withCtx(test)),
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
              leaderThreadProxy: {
                events: {
                  pull: () =>
                    Stream.fromQueue(pullQueue).pipe(
                      Stream.map((item) => ({
                        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [item] }),
                        mergeCounter: 0,
                      })),
                    ),
                  push: () => Effect.void,
                },
              },
            },
          },
        },
      })

      const _store = yield* createStore({
        schema: schema as LiveStoreSchema,
        adapter,
        storeId: 'test',
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

      const exit = yield* shutdownDeferred.pipe(Effect.exit)

      expect(exit._tag).toEqual('Failure')
    }).pipe(withCtx(test)),
  )

  // Scenario:
  // - client reboots with some persisted pending changes
  // - when client boots, it pulls some conflicting changes from the sync backend
  // - the client needs to rebase and those rebased changes need to be propagated to the client session
  //
  // related problem: the same might happen during leader re-election in the web adapter (will need proper tests as well some day)
  Vitest.scopedLive('client should push pending persisted events on boot', (test) =>
    Effect.gen(function* () {
      const { mockSyncBackend } = yield* TestContext
      const shutdownDeferred = yield* makeShutdownDeferred

      yield* mockSyncBackend.advance(
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...encode(events.todoCreated({ id: `backend_0`, text: 't2', completed: false })),
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
          clientId: 'other-client',
          sessionId: 'static-session-id',
        }),
      )

      const adapter = makeAdapter({
        storage: { type: 'in-memory' },
        sync: {
          backend: () => mockSyncBackend.makeSyncBackend,
          initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
        },
        testing: {
          overrides: {
            makeLeaderThread: {
              dbEventlog: Effect.fn(function* (makeSqliteDb) {
                const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

                yield* Eventlog.initEventlogDb(dbEventlog)

                yield* Eventlog.insertIntoEventlog(
                  LiveStoreEvent.EncodedWithMeta.make({
                    ...encode(events.todoCreated({ id: `client_0`, text: 't1', completed: false })),
                    clientId: 'client',
                    seqNum: EventSequenceNumber.make({ global: 1, client: 0 }),
                    parentSeqNum: EventSequenceNumber.ROOT,
                    sessionId: 'static-session-id',
                  }),
                  dbEventlog,
                  0, // unused mutation def schema hash
                  'client',
                  'static-session-id',
                )

                return dbEventlog
              }, Effect.orDie),
            },
          },
        },
      })

      const store = yield* createStore({
        schema: schema as LiveStoreSchema,
        adapter,
        storeId: 'test',
        shutdownDeferred,
      })

      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)

      const res = store.query(tables.todos.orderBy('text', 'asc'))

      expect(res).toMatchObject([
        { id: 'client_0', text: 't1', completed: false },
        { id: 'backend_0', text: 't2', completed: false },
      ])
    }).pipe(withCtx(test)),
  )

  // In cases where the materializer is non-pure (e.g. for events.todoDeletedNonPure calling `new Date()`),
  // the ClientSessionSyncProcessor will fail gracefully when detecting a materializer hash mismatch.
  Vitest.scopedLive('should fail gracefully if materializer is side effecting', (test) =>
    Effect.gen(function* () {
      const { makeStore, shutdownDeferred } = yield* TestContext
      const store = yield* makeStore

      store.commit(events.todoDeletedNonPure({ id: '1' }))

      const error = yield* shutdownDeferred.pipe(Effect.flip)

      expect(error._tag).toEqual('LiveStore.UnexpectedError')
      expect(error.cause).includes('Materializer hash mismatch detected for event')
    }).pipe(withCtx(test)),
  )
})

class TestContext extends Context.Tag('TestContext')<
  TestContext,
  {
    makeStore: Effect.Effect<Store, UnexpectedError, Scope.Scope | OtelTracer.OtelTracer>
    mockSyncBackend: MockSyncBackend
    shutdownDeferred: ShutdownDeferred
  }
>() {}

const TestContextLive = Layer.scoped(
  TestContext,
  Effect.gen(function* () {
    const mockSyncBackend = yield* makeMockSyncBackend
    const shutdownDeferred = yield* makeShutdownDeferred

    const adapter = makeAdapter({
      storage: { type: 'in-memory' },
      sync: { backend: () => mockSyncBackend.makeSyncBackend, onSyncError: 'shutdown' },
    })
    const makeStore = createStore({ schema: schema as LiveStoreSchema, adapter, storeId: 'test', shutdownDeferred })

    return { makeStore, mockSyncBackend, shutdownDeferred }
  }),
)

const otelLayer = IS_CI ? OtelLiveDummy : OtelLiveHttp({ serviceName: 'store-test', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix }: { suffix?: string | undefined; skipOtel?: boolean | undefined } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(IS_CI ? 60_000 : 10_000),
      Effect.provide(TestContextLive),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.provide(Logger.prettyWithThread('test-main-thread')),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      Effect.provide(otelLayer),
    )
