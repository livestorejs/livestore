import { assert, expect } from 'vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import type { MockSyncBackend } from '@livestore/common'
import { CommandExecutionError, makeMockSyncBackend, type UnknownError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import { Context, Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { EventFactory } from '@livestore/common/testing'
import { commands, events, schema, tables, TodoTextEmpty } from '../utils/tests/fixture.ts'

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
  Vitest.describe('initial execution', () => {
    Vitest.scopedLive('should return "pending" and materialize state on successful execution', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' }))

        expect(result._tag).toBe('pending')

        const todo = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(todo !== undefined)
        expect(todo.text).toBe('Buy milk')
        expect(todo.completed).toBe(false)
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

    Vitest.scopedLive('should return "failed" with typed error for recoverable handler errors', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = store.execute(commands.createTodo({ id: 'todo-1', text: '   ' }))

        assert(result._tag === 'failed')
        expect(result.error).toBeInstanceOf(TodoTextEmpty)
        expect(result.error._tag).toBe('TodoTextEmpty')

        // State DB should be unchanged
        const todo = store.query(tables.todos.where({ id: 'todo-1' }).first())
        expect(todo).toBeUndefined()
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should reject confirmation for failed initial execution', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = store.execute(commands.createTodo({ id: 'todo-1', text: '   ' }))
        assert(result._tag === 'failed')

        const outcome = yield* Effect.tryPromise({
          try: () => result.confirmation,
          catch: (err) => err as TodoTextEmpty,
        }).pipe(Effect.either)

        assert(outcome._tag === 'Left')
        expect(outcome.left).toBeInstanceOf(TodoTextEmpty)
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw `CommandExecutionError` with `CommandNotFound` reason for unknown command name', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const fakeCommand = { name: 'NonExistent', args: {}, id: 'cmd_fake' } as any

        const result = yield* Effect.try({
          try: () => store.execute(fakeCommand),
          catch: (err) => err as CommandExecutionError,
        }).pipe(Effect.either)

        assert(result._tag === 'Left')
        expect(result.left).toBeInstanceOf(CommandExecutionError)
        expect(result.left.command.name).toBe('NonExistent')
        expect(result.left.reason).toBe('CommandNotFound')
        expect(result.left.phase).toBe('initial')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw `CommandExecutionError` with `NoEventProduced` reason when handler returns empty array', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = yield* Effect.try({
          try: () => store.execute(commands.emptyCommand({})),
          catch: (err) => err as CommandExecutionError,
        }).pipe(Effect.either)

        assert(result._tag === 'Left')
        expect(result.left).toBeInstanceOf(CommandExecutionError)
        expect(result.left.command.name).toBe('EmptyCommand')
        expect(result.left.reason).toBe('NoEventProduced')
        expect(result.left.phase).toBe('initial')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw `CommandExecutionError` with `CommandHandlerThrew` reason when handler throws', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = yield* Effect.try({
          try: () => store.execute(commands.completeTodo({ id: 'non-existent' })),
          catch: (err) => err as CommandExecutionError,
        }).pipe(Effect.either)

        assert(result._tag === 'Left')
        expect(result.left).toBeInstanceOf(CommandExecutionError)
        expect(result.left._tag).toBe('LiveStore.CommandExecutionError')
        expect(result.left.command.name).toBe('CompleteTodo')
        expect(result.left.reason).toBe('CommandHandlerThrew')
        expect(result.left.phase).toBe('initial')
        assert.instanceOf(result.left.cause, Error)
        expect(result.left.cause.message).toContain('Unable to retrieve the first element of an empty array')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw `CommandExecutionError` with `string` cause when handler throws a string', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = yield* Effect.try({
          try: () => store.execute(commands.throwsString({})),
          catch: (err) => err as CommandExecutionError,
        }).pipe(Effect.either)

        assert(result._tag === 'Left')
        expect(result.left).toBeInstanceOf(CommandExecutionError)
        expect(result.left.reason).toBe('CommandHandlerThrew')
        expect(result.left.phase).toBe('initial')
        expect(result.left.cause).toBe('something went wrong')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw `CommandExecutionError` with `object` cause when handler throws a plain object', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = yield* Effect.try({
          try: () => store.execute(commands.throwsPlainObject({})),
          catch: (err) => err as CommandExecutionError,
        }).pipe(Effect.either)

        assert(result._tag === 'Left')
        expect(result.left).toBeInstanceOf(CommandExecutionError)
        expect(result.left.reason).toBe('CommandHandlerThrew')
        expect(result.left.phase).toBe('initial')
        expect(result.left.cause).toEqual({ code: 42, detail: 'unexpected' })
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should pass `ctx.phase` with _tag "initial" to command handler', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = store.execute(commands.capturePhase({ id: 'todo-1' }))
        expect(result._tag).toBe('pending')

        // The capturePhase handler embeds ctx.phase._tag into the todo text
        const todo = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(todo !== undefined)
        expect(todo.text).toBe('initial')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should support `ctx.query` with raw SQL in handler', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        // Seed two todos so the raw SQL count returns 2
        store.commit(events.todoCreated({ id: 'seed-1', text: 'First', completed: false }))
        store.commit(events.todoCreated({ id: 'seed-2', text: 'Second', completed: false }))

        const result = store.execute(commands.countTodosRawSql({ id: 'todo-3', text: 'After' }))
        expect(result._tag).toBe('pending')

        const todo = store.query(tables.todos.where({ id: 'todo-3' }).first())
        assert(todo !== undefined)
        expect(todo.text).toBe('After (count: 2)')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw when executing after shutdown', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        yield* store.shutdown()

        const result = yield* Effect.try({
          try: () => store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' })),
          catch: (err) => err as Error,
        }).pipe(Effect.either)

        assert(result._tag === 'Left')
        expect(result.left.message).toContain('Store has been shut down')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should reject pending confirmations on shutdown', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        // Block leader backend push/pull gates so command confirmation stays pending until shutdown.
        yield* mockSyncBackend.disconnect

        const result = store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' }))
        assert(result._tag === 'pending')
        yield* store.shutdown()

        const outcome = yield* Effect.tryPromise({
          try: () => result.confirmation,
          catch: (err) => err as Error,
        }).pipe(Effect.either)

        assert(outcome._tag === 'Left')
        expect(outcome.left.message).toContain('Store shutdown before command confirmation')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should serialize concurrent command executions to preserve invariants', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        // Seed a todo to establish baseline count
        store.commit(events.todoCreated({ id: 'seed-1', text: 'Existing', completed: false }))

        // Execute two commands concurrently that both read the same count
        const resultA = store.execute(commands.countTodosRawSql({ id: 'todo-a', text: 'A' }))
        const resultB = store.execute(commands.countTodosRawSql({ id: 'todo-b', text: 'B' }))

        expect(resultA._tag).toBe('pending')
        expect(resultB._tag).toBe('pending')

        // With atomicity, command B should see the state *after* command A's events are materialized.
        // A reads count=1, B should read count=2 (A's todo is materialized before B runs).
        const todoA = store.query(tables.todos.where({ id: 'todo-a' }).first())
        const todoB = store.query(tables.todos.where({ id: 'todo-b' }).first())
        assert(todoA !== undefined)
        assert(todoB !== undefined)
        expect(todoA.text).toBe('A (count: 1)')
        expect(todoB.text).toBe('B (count: 2)')
      }).pipe(withTestCtx(test)),
    )
  })

  Vitest.describe('replay execution', () => {
    Vitest.scopedLive('should confirm after successful command replay', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        yield* mockSyncBackend.disconnect

        // Seed a todo so completeTodo can succeed
        store.commit(events.todoCreated({ id: 'todo-1', text: 'Buy milk', completed: false }))

        // Execute while disconnected — events stay pending
        const result = store.execute(commands.completeTodo({ id: 'todo-1' }))
        assert(result._tag === 'pending')

        // Inject a non-conflicting external event (creates an unrelated todo)
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-2', text: 'From other client', completed: false }),
        )

        // Connect — triggers pull, rebase, and command replay
        yield* mockSyncBackend.connect

        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should resolve to conflict when replay returns error', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        yield* mockSyncBackend.disconnect

        const result = store.execute(commands.createTodoUnique({ id: 'todo-1', text: 'Mine' }))
        assert(result._tag === 'pending')

        // Inject an external event that creates todo-1 first (from another client)
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-1', text: 'Theirs', completed: false }),
        )

        // Connect — triggers pull, rebase, and command replay
        yield* mockSyncBackend.connect

        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('conflict')
        if (confirmation._tag === 'conflict') {
          expect(confirmation.error).toMatchObject({ _tag: 'TodoAlreadyExists' })
        }
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should pass `ctx.phase` with _tag "replay"', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        yield* mockSyncBackend.disconnect

        // Execute while disconnected — events stay pending
        const result = store.execute(commands.capturePhase({ id: 'todo-1' }))
        assert(result._tag === 'pending')

        // Verify initial phase
        const todoBefore = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(todoBefore !== undefined)
        expect(todoBefore.text).toBe('initial')

        // Inject an external event to trigger rebase and command replay
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-2', text: 'From other client', completed: false }),
        )

        // Connect — triggers pull, rebase, and command replay
        yield* mockSyncBackend.connect

        // Wait for the full round-trip (rebase → push → echo → advance → confirm)
        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('confirmed')

        // After replay, the handler should have re-executed with phase 'replay'
        const todoAfter = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(todoAfter !== undefined)
        expect(todoAfter.text).toBe('replay')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw `CommandExecutionError` with `CommandNotFound` reason for unknown command name', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        yield* mockSyncBackend.disconnect

        // Execute a command while disconnected — events stay pending
        const result = store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' }))
        assert(result._tag === 'pending')

        // Inject an external event to trigger rebase and command replay
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-2', text: 'From other client', completed: false }),
        )

        // TODO: Simulate a schema that no longer includes CreateTodo.
        // This requires a way to swap the schema between initial execution and replay.

        // Connect — triggers pull, rebase, and command replay
        yield* mockSyncBackend.connect

        // Expect the replay to die with CommandNotFound and phase 'replay'
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw CommandExecutionError with `CommandHandlerThrew` reason when handler throws', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        // Seed a todo so completeTodo succeeds initially
        store.commit(events.todoCreated({ id: 'todo-1', text: 'Buy milk', completed: false }))

        yield* mockSyncBackend.disconnect

        // Execute completeTodo while disconnected — succeeds because todo-1 exists
        const result = store.execute(commands.completeTodo({ id: 'todo-1' }))
        assert(result._tag === 'pending')

        // Inject an external event that deletes todo-1, so replay of completeTodo will throw
        // TODO: Add a todoDeleted event to the fixture to enable this scenario.
        // For now, this test outlines the expected behavior.
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-3', text: 'From other client', completed: false }),
        )

        // Connect — triggers pull, rebase, and command replay
        yield* mockSyncBackend.connect

        // Expect the replay to die with CommandHandlerThrew and phase 'replay'
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw `CommandExecutionError` with `NoEventProduced` reason when handler returns empty array', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        yield* mockSyncBackend.disconnect

        // Execute a command that returns events initially
        // TODO: Add a fixture command whose handler conditionally returns [] based on state,
        // so that after an external event changes state, replay produces no events.
        const result = store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' }))
        assert(result._tag === 'pending')

        // Inject an external event to trigger rebase and command replay
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-2', text: 'From other client', completed: false }),
        )

        // Connect — triggers pull, rebase, and command replay
        yield* mockSyncBackend.connect

        // Expect the replay to die with NoEventProduced and phase 'replay'
      }).pipe(withTestCtx(test)),
    )
  })
})

class TestContext extends Context.Tag('TestContext')<
  TestContext,
  {
    makeStore: (args?: { boot?: (store: Store) => void }) => Effect.Effect<Store, UnknownError, Scope.Scope | OtelTracer.OtelTracer>
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
