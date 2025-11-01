import { makeInMemoryAdapter } from '@livestore/adapter-web'
import type { MockSyncBackend } from '@livestore/common'
import { type ClientSessionLeaderThreadProxy, makeMockSyncBackend, type UnexpectedError } from '@livestore/common'
import type { LiveStoreEvent, LiveStoreSchema } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Effect, FetchHttpClient, Layer, Logger, LogLevel, Queue, Stream } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { events, schema } from '../utils/tests/fixture.ts'

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
  Vitest.scopedLive('should resume when reconnected to sync backend', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()
      yield* mockSyncBackend.connect

      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      const eventsQueue = yield* Queue.unbounded<LiveStoreEvent.ForSchema<typeof schema>>()

      yield* store.eventsStream().pipe(
        Stream.tap((event) => Queue.offer(eventsQueue, event)),
        Stream.runDrain,
        Effect.forkScoped,
      )

      store.commit(eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }))
      const initialEvent = yield* Queue.take(eventsQueue)
      expect(initialEvent.name).toEqual('todo.created')
      expect(initialEvent.args).toMatchObject({ id: '1' })

      yield* mockSyncBackend.disconnect
      store.commit(eventFactory.todoCreated.next({ id: '2', text: 't2', completed: false }))
      const maybeWhileDisconnected = yield* Queue.take(eventsQueue).pipe(Effect.timeout('250 millis'), Effect.option)
      expect(maybeWhileDisconnected._tag).toEqual('None')

      yield* mockSyncBackend.connect
      const resumedEvent = yield* Queue.take(eventsQueue)
      expect(resumedEvent.name).toEqual('todo.created')
      expect(resumedEvent.args).toMatchObject({ id: '2' })
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
