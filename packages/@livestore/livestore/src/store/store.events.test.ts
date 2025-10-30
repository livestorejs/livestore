import { makeInMemoryAdapter } from '@livestore/adapter-web'
import type { MockSyncBackend } from '@livestore/common'
import { type ClientSessionLeaderThreadProxy, makeMockSyncBackend, type UnexpectedError } from '@livestore/common'
import { LiveStoreEvent, type LiveStoreSchema } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import {
  Chunk,
  Context,
  Effect,
  FetchHttpClient,
  Fiber,
  Layer,
  Logger,
  LogLevel,
  Queue,
  Stream,
} from '@livestore/utils/effect'
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
  Vitest.scopedLive('should stream backend confirmed events', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()
      yield* mockSyncBackend.connect

      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      const collected: Array<LiveStoreEvent.ForSchema<typeof schema>> = []
      const streamFiber = yield* store.eventsStream({ filter: ['todo.completed'] as const }).pipe(
        Stream.tap((event) => Effect.sync(() => collected.push(event))),
        Stream.take(2),
        Stream.runDrain,
        Effect.forkScoped,
      )

      store.commit(
        eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }),
        eventFactory.todoCompleted.next({ id: '1' }),
        eventFactory.todoCreated.next({ id: '2', text: 't2', completed: false }),
        eventFactory.todoCompleted.next({ id: '2' }),
      )

      yield* Fiber.join(streamFiber).pipe(Effect.timeout('5 seconds'))

      expect(collected).toHaveLength(2)
      expect(collected[0]?.name).toEqual('todo.completed')
      expect(collected[0]?.args).toMatchObject({ id: '1' })
      expect(collected[1]?.name).toEqual('todo.completed')
      expect(collected[1]?.args).toMatchObject({ id: '2' })
    }).pipe(withTestCtx(test)),
  )
  Vitest.scopedLive('should resume when reconnected to sync backend', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()
      yield* mockSyncBackend.connect

      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      const eventQueue = yield* Queue.unbounded<LiveStoreEvent.ForSchema<typeof schema>>()

      yield* store.eventsStream().pipe(
        Stream.tapChunk((chunk) => Queue.offerAll(eventQueue, chunk)),
        Stream.runDrain,
        Effect.forkScoped,
      )

      store.commit(eventFactory.todoCreated.next({ id: '1', text: 't1', completed: false }))
      yield* Effect.sleep('100 millis')
      const eventsAfterFirst = yield* Queue.takeAll(eventQueue)
      const eventsAfterFirstArray = Chunk.toReadonlyArray(eventsAfterFirst)
      expect(eventsAfterFirstArray).toHaveLength(1)
      expect(eventsAfterFirstArray[0]?.name).toEqual('todo.created')
      expect(eventsAfterFirstArray[0]?.args).toMatchObject({ id: '1', text: 't1' })

      yield* mockSyncBackend.disconnect
      store.commit(eventFactory.todoCreated.next({ id: '2', text: 't2', completed: false }))
      yield* Effect.sleep('100 millis')
      const eventsAfterDisconnect = yield* Queue.takeAll(eventQueue)
      const eventsAfterDisconnectArray = Chunk.toReadonlyArray(eventsAfterDisconnect)
      expect(eventsAfterDisconnectArray).toHaveLength(0)

      yield* mockSyncBackend.connect
      yield* Effect.sleep('100 millis')
      const eventsAfterReconnect = yield* Queue.takeAll(eventQueue)
      const eventsAfterReconnectArray = Chunk.toReadonlyArray(eventsAfterReconnect)
      expect(eventsAfterReconnectArray).toHaveLength(1)
      expect(eventsAfterReconnectArray[0]?.name).toEqual('todo.created')
      expect(eventsAfterReconnectArray[0]?.args).toMatchObject({ id: '2', text: 't2' })
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
