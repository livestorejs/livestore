import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { Context, Effect, Logger, LogLevel, Stream } from '@livestore/utils/effect'
import type { Store } from '@livestore/livestore'
import type { Scope } from '@livestore/utils/effect'
import type { OtelTracer } from '@livestore/utils/effect'
import type { MockSyncBackend } from '@livestore/common'
import {
  type BootStatus,
  type ClientSessionLeaderThreadProxy,
  makeMockSyncBackend,
  SyncState,
  type UnexpectedError,
} from '@livestore/common'
import type { ShutdownDeferred } from '@livestore/livestore'
import { Layer, FetchHttpClient } from '@livestore/utils/effect'
import { makeShutdownDeferred } from '@livestore/livestore'
import { nanoid } from '@livestore/utils/nanoid'
import { omitUndefineds } from '@livestore/utils'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { createStore } from '@livestore/livestore'
import { PlatformNode } from '@livestore/utils/node'
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
  Vitest.scopedLive('should stream events with filtering', (_test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

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
          Stream.tapSync((event) => collected.push(event)),
          Stream.runDrain,
        )

      expect(collected).toHaveLength(2)

    }).pipe(withTestCtx(_test)),

    // Effect.scoped(
    //   Effect.gen(function* () {
    //     const { store } = yield* makeTestStore

    //     store.commit(
    //       events.todoCreated({ id: '1', text: 'Test todo', completed: false }),
    //       events.todoCreated({ id: '2', text: 'Test todo 2', completed: false }),
    //       events.todoCompleted({ id: '1' }),
    //     )

    //     const collected: any[] = []
    //     yield* store
    //       .eventsStream({
    //         filter: ['todo.created'],
    //         snapshotOnly: true,
    //       })
    //       .pipe(
    //         Stream.tapSync((event) => collected.push(event)),
    //         Stream.runDrain,
    //       )

    //     expect(collected).toHaveLength(2)
    //   }),
    // ),
  )

  // Vitest.scopedLive('should stream backend confirmed events', (_test) =>
  //   Effect.scoped(
  //     Effect.gen(function* () {
  //       const { store, waitForBackendIdle } = yield* makeTestStore

  //       store.commit(events.todoCreated({ id: '1', text: 'Pending todo', completed: false }))

  //       yield* waitForBackendIdle

  //       const collected: any[] = []

  //       yield* store
  //         .eventsStream({
  //           minSyncLevel: 'backend',
  //           filter: ['todo.created'],
  //           snapshotOnly: true,
  //         })
  //         .pipe(Stream.tapSync((event) => collected.push(event)), Stream.runDrain)

  //       expect(collected).toHaveLength(1)
  //       expect(collected[0]?.name).toBe('todo.created')
  //     }),
  //   ),
  // )
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