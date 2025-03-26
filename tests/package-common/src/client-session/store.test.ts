import '@livestore/utils/node-vitest-polyfill'

import { makeInMemoryAdapter } from '@livestore/adapter-node'
import { SyncState, type UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventId, MutationEvent } from '@livestore/common/schema'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Effect, FetchHttpClient, Layer, Logger, Queue, Schema, Stream } from '@livestore/utils/effect'
import { OtelLiveDummy, OtelLiveHttp, PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils/node-vitest'
import { expect } from 'vitest'

import { schema, tables } from '../leader-thread/fixture.js'
import type { MockSyncBackend } from '../mock-sync-backend.js'
import { makeMockSyncBackend } from '../mock-sync-backend.js'

Vitest.describe('Store', () => {
  Vitest.describe('ClientSessionSyncProcessor', () => {
    Vitest.scopedLive('from scratch', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore

        store.commit(tables.todos.insert({ id: '1', text: 't1', completed: false }))

        yield* mockSyncBackend.pushedMutationEvents.pipe(Stream.take(1), Stream.runDrain)
      }).pipe(withCtx(test)),
    )

    Vitest.scopedLive('sync backend is ahead', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const mutationEventSchema = MutationEvent.makeMutationEventPartialSchema(
          schema,
        ) as TODO as Schema.Schema<MutationEvent.PartialAnyEncoded>
        const encoded = Schema.encodeSync(mutationEventSchema)(
          tables.todos.insert({ id: '1', text: 't1', completed: false }),
        )

        // yield* mockSyncBackend.connect

        const store = yield* makeStore

        store.commit(tables.todos.insert({ id: '2', text: 't2', completed: false }))

        yield* mockSyncBackend.advance({
          ...encoded,
          id: EventId.globalEventId(0),
          parentId: EventId.ROOT.global,
          clientId: 'other-client',
          sessionId: 'static-session-id',
        })

        yield* mockSyncBackend.pushedMutationEvents.pipe(Stream.take(1), Stream.runDrain)
      }).pipe(withCtx(test)),
    )
  })

  Vitest.scopedLive('race condition between client session and sync backend', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext

      // TODO fix type level - derived mutations are missing and thus infers to `never` currently
      const mutationEventSchema = MutationEvent.makeMutationEventPartialSchema(
        schema,
      ) as TODO as Schema.Schema<MutationEvent.PartialAnyEncoded>
      const encode = Schema.encodeSync(mutationEventSchema)

      const store = yield* makeStore

      for (let i = 0; i < 5; i++) {
        yield* mockSyncBackend
          .advance({
            ...encode(tables.todos.insert({ id: `backend_${i}`, text: '', completed: false })),
            id: EventId.globalEventId(i),
            parentId: EventId.globalEventId(i - 1),
            clientId: 'other-client',
            sessionId: 'static-session-id',
          })
          .pipe(Effect.fork)
      }

      for (let i = 0; i < 5; i++) {
        store.commit(tables.todos.insert({ id: `local_${i}`, text: '', completed: false }))
      }

      yield* mockSyncBackend.pushedMutationEvents.pipe(Stream.take(5), Stream.runDrain)
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('should fail for event that is not larger than expected upstream', (test) =>
    Effect.gen(function* () {
      const shutdownDeferred = yield* makeShutdownDeferred
      const pullQueue = yield* Queue.unbounded<MutationEvent.EncodedWithMeta>()

      const adapter = makeInMemoryAdapter({
        testing: {
          overrides: {
            leaderThread: {
              mutations: {
                pull: () =>
                  Stream.fromQueue(pullQueue).pipe(
                    Stream.map((item) => ({
                      payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [item] }),
                      remaining: 0,
                    })),
                  ),
                push: () => Effect.void,
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

      const mutationEventSchema = MutationEvent.makeMutationEventPartialSchema(
        schema,
      ) as TODO as Schema.Schema<MutationEvent.PartialAnyEncoded>
      const encode = Schema.encodeSync(mutationEventSchema)

      yield* Queue.offer(
        pullQueue,
        MutationEvent.EncodedWithMeta.make({
          ...encode(tables.todos.insert({ id: `id_0`, text: '', completed: false })),
          id: EventId.make({ global: 0, client: 0 }),
          parentId: EventId.ROOT,
          clientId: 'other-client',
          sessionId: 'static-session-id',
        }),
      ).pipe(Effect.repeatN(1))

      const exit = yield* shutdownDeferred.pipe(Effect.exit)

      expect(exit._tag).toEqual('Failure')
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

    const adapter = makeInMemoryAdapter({ sync: { backend: () => mockSyncBackend.makeSyncBackend } })
    const makeStore = createStore({ schema: schema as LiveStoreSchema, adapter, storeId: 'test', shutdownDeferred })

    return { makeStore, mockSyncBackend, shutdownDeferred }
  }),
)

const otelLayer = IS_CI ? OtelLiveDummy : OtelLiveHttp({ serviceName: 'store-test', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(IS_CI ? 60_000 : 10_000),
      Effect.provide(TestContextLive),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Effect.provide(Logger.prettyWithThread('test-main-thread')),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      Effect.provide(otelLayer),
    )
