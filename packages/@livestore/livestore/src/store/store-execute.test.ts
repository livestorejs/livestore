import { expect } from 'vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import type { MockSyncBackend } from '@livestore/common'
import { type ClientSessionLeaderThreadProxy, CommandExecutionError, makeMockSyncBackend, type UnknownError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'

import { commands, schema, tables, TodoTextEmpty } from '../utils/tests/fixture.ts'

const withTestCtx = Vitest.makeWithTestCtx({
  makeLayer: () =>
    Layer.mergeAll(
      TestContextLive,
      PlatformNode.NodeFileSystem.layer,
      FetchHttpClient.layer,
      Logger.minimumLogLevel(LogLevel.Debug),
    ),
})

Vitest.describe('store.execute', () => {
  Vitest.scopedLive('should return pending and materialize state on successful execution', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

      const result = store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' }))

      expect(result._tag).toBe('pending')

      const todo = store.query(tables.todos.where({ id: 'todo-1' }).first())
      expect(todo).toBeDefined()
      expect(todo!.text).toBe('Buy milk')
      expect(todo!.completed).toBe(false)
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should return failed with typed error for recoverable handler errors', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

      const result = store.execute(commands.createTodo({ id: 'todo-1', text: '   ' }))

      expect(result._tag).toBe('failed')
      if (result._tag !== 'failed') return
      expect(result.error).toBeInstanceOf(TodoTextEmpty)
      expect(result.error._tag).toBe('TodoTextEmpty')

      // State DB should be unchanged
      const todo = store.query(tables.todos.where({ id: 'todo-1' }).first())
      expect(todo).toBeUndefined()
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should throw CommandExecutionError for unknown command name', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

      const fakeCommand = { name: 'NonExistent', args: {}, id: 'cmd_fake' } as any

      const result = yield* Effect.try({
        try: () => store.execute(fakeCommand),
        catch: (err) => err as CommandExecutionError,
      }).pipe(Effect.either)

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') return;

      expect(result.left).toBeInstanceOf(CommandExecutionError)
      expect(result.left.command.name).toBe('NonExistent')
      expect(result.left.reason).toBe('CommandNotFound')
      expect(result.left.phase).toBe('initial')
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should throw CommandExecutionError when handler returns empty array', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

      const result = yield* Effect.try({
        try: () => store.execute(commands.emptyCommand({})),
        catch: (err) => err as CommandExecutionError,
      }).pipe(Effect.either)

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') return;

      expect(result.left).toBeInstanceOf(CommandExecutionError)
      expect(result.left.command.name).toBe('EmptyCommand')
      expect(result.left.reason).toBe('NoEventProduced')
      expect(result.left.phase).toBe('initial')
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should throw CommandExecutionError when handler throws', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

      const result = yield* Effect.try({
        try: () => store.execute(commands.completeTodo({ id: 'non-existent' })),
        catch: (err) => err as CommandExecutionError,
      }).pipe(Effect.either)

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') return;

      expect(result.left).toBeInstanceOf(CommandExecutionError)
      expect(result.left._tag).toBe('LiveStore.CommandExecutionError')
      expect(result.left.command.name).toBe('CompleteTodo')
      expect(result.left.reason).toBe('CommandHandlerThrew')
      expect(result.left.phase).toBe('initial')
      expect(result.left.cause).toBeInstanceOf(Error)
      expect((result.left.cause as Error).message).toBe('Todo not found')
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should reject confirmation for failed initial execution', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

      const result = store.execute(commands.createTodo({ id: 'todo-1', text: '   ' }))
      expect(result._tag).toBe('failed')
      if (result._tag !== 'failed') return;


      const outcome = yield* Effect.tryPromise({
        try: () => result.confirmation,
        catch: (err) => err as TodoTextEmpty,
      }).pipe(Effect.either)

      expect(outcome._tag).toBe('Left')
      if (outcome._tag !== 'Left') return;

      expect(outcome.left).toBeInstanceOf(TodoTextEmpty)
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should confirm when events leave sync pending state', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()
      yield* mockSyncBackend.connect

      const result = store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' }))
      expect(result._tag).toBe('pending')
      if (result._tag !== 'pending') return;

      const confirmation = yield* Effect.promise(() => result.confirmation)
      expect(confirmation._tag).toBe('confirmed')
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('should materialize all events when handler returns multiple events', (test) =>
    Effect.gen(function* () {
      const { makeStore } = yield* TestContext
      const store = yield* makeStore()

      const result = store.execute(
        commands.multiEventCommand({
          todos: [
            { id: 'todo-1', text: 'First' },
            { id: 'todo-2', text: 'Second' },
            { id: 'todo-3', text: 'Third' },
          ],
        }),
      )

      expect(result._tag).toBe('pending')

      const allTodos = store.query({ query: 'SELECT id, text, completed FROM todos ORDER BY id', bindValues: {} })
      expect(allTodos).toHaveLength(3)
      expect((allTodos as Array<{ id: string }>).map((t) => t.id)).toEqual(['todo-1', 'todo-2', 'todo-3'])
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
    }) => Effect.Effect<Store, UnknownError, Scope.Scope | OtelTracer.OtelTracer>
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
