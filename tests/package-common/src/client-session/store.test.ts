import { makeInMemoryAdapter } from '@livestore/adapter-node'
import type { UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventId, MutationEvent } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import { createStore } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Effect, FetchHttpClient, Layer, Logger, Schema, Stream } from '@livestore/utils/effect'
import { OtelLiveDummy, OtelLiveHttp, PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils/node-vitest'

import { schema, tables } from '../leader-thread/fixture.js'
import type { MockSyncBackend } from '../mock-sync-backend.js'
import { makeMockSyncBackend } from '../mock-sync-backend.js'

Vitest.describe('Store', () => {
  Vitest.describe('ClientSessionSyncProcessor', () => {
    Vitest.scopedLive('from scratch', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore

        store.mutate(tables.todos.insert({ id: '1', text: 't1', completed: false }))

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

        store.mutate(tables.todos.insert({ id: '2', text: 't2', completed: false }))

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
        store.mutate(tables.todos.insert({ id: `local_${i}`, text: '', completed: false }))
      }

      yield* mockSyncBackend.pushedMutationEvents.pipe(Stream.take(5), Stream.runDrain)
    }).pipe(withCtx(test)),
  )
})

class TestContext extends Context.Tag('TestContext')<
  TestContext,
  {
    makeStore: Effect.Effect<Store, UnexpectedError, Scope.Scope | OtelTracer.OtelTracer>
    mockSyncBackend: MockSyncBackend
  }
>() {}

const TestContextLive = Layer.scoped(
  TestContext,
  Effect.gen(function* () {
    const mockSyncBackend = yield* makeMockSyncBackend

    const adapter = makeInMemoryAdapter({ sync: { makeBackend: () => mockSyncBackend.makeSyncBackend } })
    const makeStore = createStore({ schema: schema as LiveStoreSchema, adapter, storeId: 'test' })

    return { makeStore, mockSyncBackend }
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
      Effect.provide(Logger.pretty),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      Effect.provide(otelLayer),
    )
