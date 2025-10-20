import { makeInMemoryAdapter } from '@livestore/adapter-web'
import type { MockSyncBackend } from '@livestore/common'
import { type ClientSessionLeaderThreadProxy, makeMockSyncBackend, type UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Effect, FetchHttpClient, Layer, Logger, LogLevel, Stream } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { events, schema } from '../utils/tests/fixture.ts'
import { EventFactory } from '@livestore/common/testing'

const withTestCtx = Vitest.makeWithTestCtx({
  makeLayer: () =>
    Layer.mergeAll(
      TestContextLive,
      PlatformNode.NodeFileSystem.layer,
      FetchHttpClient.layer,
      Logger.minimumLogLevel(LogLevel.Debug),
    ),
})

Vitest.describe('Store events API', () => {
  Vitest.scopedLive('should stream events with filtering', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

      // One commit with array
      store.commit(events.todoCreated({ id: '1', text: 'Test todo', completed: false }))
      store.commit(events.todoCreated({ id: '2', text: 'Test todo 2', completed: false }))
      store.commit(events.todoCompleted({ id: '1' }))

      const collected: any[] = []
      yield* store
        .eventsStream({
          filter: ['todo.created'],
          snapshotOnly: true,
        })
        .pipe(
          Stream.tapSync((event) => collected.push(event)), // runCollect
          Stream.runDrain,
        )
      expect(collected).toHaveLength(2)
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should stream backend confirmed events', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()
      // const store = yield* makeStore({
      //   testing: {
      //     overrides: {
      //       clientSession: {
      //         leaderThreadProxy: (leader) => ({
      //           events: {
      //             pull: ({ cursor }) =>
      //               Effect.sync(() => {
      //                 console.log('pull', cursor)
      //                 return leader.events.pull({ cursor })
      //               }).pipe(Stream.unwrap),
      //             push: () =>
      //               Effect.sync(() => {
      //                 console.log('push')
      //                 return leader.events.push([])
      //               }),
      //             //leader.events.push,
      //             stream: leader.events.stream,
      //           },
      //         }),
      //       },
      //     },
      //   },
      // })

      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      yield* mockSyncBackend.advance(eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }))
      yield* mockSyncBackend.pushedEvents.pipe(Stream.take(1), Stream.runDrain)

      // const collected: any[] = []
      // yield* store
      //   .eventsStream({
      //     minSyncLevel: 'backend',
      //     filter: ['todo.created'],
      //   })
      //   .pipe(
      //     Stream.tapSync((event) => collected.push(event)),
      //     Stream.take(1),
      //     Stream.runDrain,
      //   )
      // expect(collected).toHaveLength(1)
    }).pipe(withTestCtx(test)),
  )
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
      const adapter = makeInMemoryAdapter({
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
