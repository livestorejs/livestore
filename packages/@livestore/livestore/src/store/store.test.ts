import { assert, expect } from 'vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import type { MockSyncBackend } from '@livestore/common'
import { type ClientSessionLeaderThreadProxy, CommandExecutionError, makeMockSyncBackend, type UnknownError } from '@livestore/common'
import { EventSequenceNumber, type LiveStoreEvent, type LiveStoreSchema } from '@livestore/common/schema'
import type { ShutdownDeferred, Store } from '@livestore/livestore'
import { createStore, makeShutdownDeferred } from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import type { OtelTracer, Scope } from '@livestore/utils/effect'
import { Chunk, Context, Deferred, Effect, FetchHttpClient, Layer, Logger, LogLevel, Queue, Stream } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { PlatformNode } from '@livestore/utils/node'
import { EventFactory } from '@livestore/common/testing'
import { commands, events, schema, tables, TodoAlreadyExists, TodoTextEmpty } from '../utils/tests/fixture.ts'
import { StoreInternalsSymbol } from './store-types.ts'

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

    Vitest.scopedLive('should preserve ordering between interleaved commit() and execute() calls', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        // commit → execute → commit: all three must be processed in order by the leader
        store.commit(events.todoCreated({ id: 'seed', text: 'Seed', completed: false }))
        const execResult = store.execute(commands.completeTodo({ id: 'seed' }))
        store.commit(events.todoCreated({ id: 'new-1', text: 'New', completed: false }))

        expect(execResult._tag).toBe('pending')

        // Wait for all 3 events to be pushed to the sync backend
        const pushed = yield* mockSyncBackend.pushedEvents.pipe(
          Stream.take(3),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
        )

        // Verify event order: todo.created(seed), todo.completed(seed), todo.created(new-1)
        expect(pushed).toHaveLength(3)
        expect(pushed[0]!.name).toBe('todo.created')
        expect(pushed[0]!.args).toMatchObject({ id: 'seed' })
        expect(pushed[1]!.name).toBe('todo.completed')
        expect(pushed[1]!.args).toMatchObject({ id: 'seed' })
        expect(pushed[2]!.name).toBe('todo.created')
        expect(pushed[2]!.args).toMatchObject({ id: 'new-1' })

        // Verify final state: seed is completed, new-1 exists and not completed
        const seed = store.query(tables.todos.where({ id: 'seed' }).first())
        assert(seed !== undefined)
        expect(seed.completed).toBe(true)

        const newTodo = store.query(tables.todos.where({ id: 'new-1' }).first())
        assert(newTodo !== undefined)
        expect(newTodo.completed).toBe(false)
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should confirm when backend confirms events', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        // Execute while connected — no external events, no disconnect.
        const result = store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' }))
        assert(result._tag === 'pending')

        // Confirmation should resolve.
        const confirmation = yield* Effect.promise(() => result.confirmation)
        assert(confirmation !== undefined, 'confirmation timed out')
        expect(confirmation._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should confirm after reconnect even without external events', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        yield* mockSyncBackend.disconnect

        const result = store.execute(commands.createTodo({ id: 'todo-1', text: 'Buy milk' }))
        assert(result._tag === 'pending')

        // Reconnect — no external events injected.
        yield* mockSyncBackend.connect

        const confirmation = yield* Effect.promise(() => result.confirmation)
        assert(confirmation !== undefined, 'confirmation timed out')
        expect(confirmation._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should confirm multiple commands', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const r1 = store.execute(commands.createTodo({ id: 'todo-1', text: 'First' }))
        const r2 = store.execute(commands.createTodo({ id: 'todo-2', text: 'Second' }))
        assert(r1._tag === 'pending')
        assert(r2._tag === 'pending')

        const [c1, c2] = yield* Effect.all([
          Effect.promise(() => r1.confirmation),
          Effect.promise(() => r2.confirmation),
        ])

        assert(c1 !== undefined, 'first confirmation timed out')
        assert(c2 !== undefined, 'second confirmation timed out')
        expect(c1._tag).toBe('confirmed')
        expect(c2._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should remain operational after a command fails', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        // Commit a valid event first
        store.commit(events.todoCreated({ id: 'todo-1', text: 'Before', completed: false }))

        // completeTodo for non-existent id throws on the leader (session also throws, so catch it)
        yield* Effect.try(() => store.execute(commands.completeTodo({ id: 'non-existent' }))).pipe(Effect.ignore)

        // Commit another valid event — store must still be functional
        store.commit(events.todoCreated({ id: 'todo-2', text: 'After', completed: false }))

        const todo1 = store.query(tables.todos.where({ id: 'todo-1' }).first())
        const todo2 = store.query(tables.todos.where({ id: 'todo-2' }).first())
        assert(todo1 !== undefined)
        assert(todo2 !== undefined)
        expect(todo1.text).toBe('Before')
        expect(todo2.text).toBe('After')

        // Verify sync still works — the two valid events should reach the backend
        const pushed = yield* mockSyncBackend.pushedEvents.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
          Effect.timeout('5 seconds'),
        )
        assert(pushed !== undefined, 'sync stalled — pushed events timed out')
        expect(pushed).toHaveLength(2)
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should return "pending" when handler returns a single event wrapped in an array', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        const result = store.execute(commands.createTodoWrapped({ id: 'todo-1', text: 'Buy milk' }))

        expect(result._tag).toBe('pending')

        const todo = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(todo !== undefined)
        expect(todo.text).toBe('Buy milk')
        expect(todo.completed).toBe(false)
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should support `ctx.query` with query builder in handler', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        // Seed a todo to read via query builder
        store.commit(events.todoCreated({ id: 'seed-1', text: 'Hello', completed: false }))

        const result = store.execute(commands.queryBuilderRead({ id: 'seed-1', suffix: 'World' }))
        expect(result._tag).toBe('pending')

        const derived = store.query(tables.todos.where({ id: 'seed-1-derived' }).first())
        assert(derived !== undefined)
        expect(derived.text).toBe('Hello-World')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should remain operational after a command returns a domain error', (test) =>
      Effect.gen(function* () {
        const { makeStore } = yield* TestContext
        const store = yield* makeStore()

        // First command fails with domain error
        const failed = store.execute(commands.createTodo({ id: 'todo-1', text: '   ' }))
        assert(failed._tag === 'failed')
        expect(failed.error).toBeInstanceOf(TodoTextEmpty)

        // Second command should succeed and confirm
        const success = store.execute(commands.createTodo({ id: 'todo-2', text: 'Valid' }))
        assert(success._tag === 'pending')

        const todo = store.query(tables.todos.where({ id: 'todo-2' }).first())
        assert(todo !== undefined)
        expect(todo.text).toBe('Valid')

        const confirmation = yield* Effect.promise(() => success.confirmation)
        expect(confirmation._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should confirm a multi-event command atomically', (test) =>
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

        assert(result._tag === 'pending')

        // Single confirmation for the entire command
        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('confirmed')

        // All 3 todos exist
        for (const id of ['todo-1', 'todo-2', 'todo-3']) {
          const todo = store.query(tables.todos.where({ id }).first())
          assert(todo !== undefined, `${id} should exist`)
        }
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should handle a command that produces both synced and client-only events', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        const result = store.execute(commands.createAndHighlightTodo({ id: 'todo-1', text: 'Highlighted' }))
        assert(result._tag === 'pending')

        // Both effects are materialized locally
        const todo = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(todo !== undefined)
        expect(todo.text).toBe('Highlighted')

        const highlight = store.query(tables.highlights.where({ todoId: 'todo-1' }).first())
        assert(highlight !== undefined)

        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('confirmed')

        // Push a second command to flush the stream, then verify only synced events reached the backend
        store.execute(commands.createTodo({ id: 'todo-2', text: 'Marker' }))

        const pushed = yield* mockSyncBackend.pushedEvents.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
        )
        // Only synced events (todo.created) should be pushed; todo.highlighted is client-only
        expect(pushed).toHaveLength(2)
        expect(pushed[0]!.name).toBe('todo.created')
        expect(pushed[1]!.name).toBe('todo.created')
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

    Vitest.scopedLive('should reject confirmation when validation fails on leader state', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const commandPushEntered = yield* Deferred.make<void, never>()
        const releaseCommandPush = yield* Deferred.make<void, never>()
        const store = yield* makeStore()
        const leaderThreadProxy = store[StoreInternalsSymbol].clientSession.leaderThread
        const originalPushCommand = leaderThreadProxy.commands.push
        leaderThreadProxy.commands.push = (command) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(commandPushEntered, undefined)
            yield* Deferred.await(releaseCommandPush)
            return yield* originalPushCommand(command)
          })

        // Commit while connected so the create becomes the same authoritative event on the leader.
        store.commit(events.todoCreated({ id: 'todo-1', text: 'Seed', completed: false }))

        const pushed = yield* mockSyncBackend.pushedEvents.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
        )
        expect(pushed).toHaveLength(1)
        expect(pushed[0]!.name).toBe('todo.created')

        // Optimistically succeeds against the stale local view where the todo still exists.
        const result = store.execute(commands.completeTodo({ id: 'todo-1' }))
        assert(result._tag === 'pending')
        yield* Deferred.await(commandPushEntered)

        const optimisticTodo = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(optimisticTodo !== undefined)
        expect(optimisticTodo.completed).toBe(true)

        // Another client deletes the same authoritative todo directly on the leader
        // before this session's command reaches it.
        const leaderSyncState = yield* leaderThreadProxy.syncState
        expect(leaderSyncState.localHead.global).toBe(1)

        const deleteEvent = {
          ...events.todoDeleted.encoded({ id: 'todo-1' }),
          ...EventSequenceNumber.Client.nextPair({
            seqNum: leaderSyncState.localHead,
            isClient: false,
          }),
          clientId: 'other-client',
          sessionId: 'other-client-session',
        }
        yield* leaderThreadProxy.events.push([deleteEvent])
        const leaderAfterDelete = yield* leaderThreadProxy.syncState
        expect(leaderAfterDelete.localHead.global).toBe(2)

        // Let the pending command reach the leader only after the delete is authoritative there.
        yield* Deferred.succeed(releaseCommandPush, undefined)

        const outcome = yield* Effect.tryPromise({
          try: () => result.confirmation,
          catch: (err) => err as CommandExecutionError,
        }).pipe(Effect.either)

        const deletedTodo = store.query(tables.todos.where({ id: 'todo-1' }).first())

        assert(outcome._tag === 'Left')
        expect(outcome.left).toBeInstanceOf(CommandExecutionError)
        expect(outcome.left.reason).toBe('CommandHandlerThrew')
        expect(outcome.left.phase).toBe('initial')
        expect(deletedTodo).toBeUndefined()

        const leaderAfterRelease = yield* leaderThreadProxy.syncState
        expect(leaderAfterRelease.localHead.global).toBe(2)
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should remain consistent when replay produces a different event count', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        // Seed 2 incomplete todos
        store.commit(events.todoCreated({ id: 'todo-1', text: 'First', completed: false }))
        store.commit(events.todoCreated({ id: 'todo-2', text: 'Second', completed: false }))

        yield* mockSyncBackend.disconnect

        // Execute completeAllTodos — produces 2 todoCompleted events (todo-1, todo-2)
        const result = store.execute(commands.completeAllTodos({}))
        assert(result._tag === 'pending')

        // Inject an external event that adds a 3rd incomplete todo
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-3', text: 'From other', completed: false }),
        )

        // Reconnect — triggers rebase. Replay now sees 3 incomplete todos → 3 events (was 2).
        yield* mockSyncBackend.connect

        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('confirmed')

        // All 3 todos should be completed after replay
        for (const id of ['todo-1', 'todo-2', 'todo-3']) {
          const todo = store.query(tables.todos.where({ id }).first())
          assert(todo !== undefined, `${id} should exist`)
          expect(todo.completed).toBe(true)
        }

        // Verify the store remains operational with a subsequent command
        const result2 = store.execute(commands.createTodo({ id: 'todo-4', text: 'After replay' }))
        assert(result2._tag === 'pending')

        const confirmation2 = yield* Effect.promise(() => result2.confirmation)
        expect(confirmation2._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should handle replay conflict with interleaved non-command events', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        // Seed a todo so completeTodo can succeed
        store.commit(events.todoCreated({ id: 'todo-1', text: 'Seed', completed: false }))

        yield* mockSyncBackend.disconnect

        // Interleave non-command events with commands:
        // commit → execute (will conflict on replay) → commit → execute (will succeed)
        store.commit(events.todoCreated({ id: 'todo-2', text: 'NonCmd-1', completed: false }))
        const conflicting = store.execute(commands.createTodoUnique({ id: 'todo-3', text: 'Mine' }))
        store.commit(events.todoCreated({ id: 'todo-4', text: 'NonCmd-2', completed: false }))
        const surviving = store.execute(commands.completeTodo({ id: 'todo-1' }))

        assert(conflicting._tag === 'pending')
        assert(surviving._tag === 'pending')

        // External event creates todo-3 first — will conflict with createTodoUnique
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-3', text: 'Theirs', completed: false }),
        )

        // Reconnect — rebase replays both commands.
        // createTodoUnique(todo-3) → conflict (todo-3 already exists)
        // completeTodo(todo-1) → success
        yield* mockSyncBackend.connect

        const conflictConfirmation = yield* Effect.promise(() => conflicting.confirmation)
        expect(conflictConfirmation._tag).toBe('conflict')
        assert(conflictConfirmation._tag === 'conflict')
        expect(conflictConfirmation.error._tag).toBe('TodoAlreadyExists')

        const surviveConfirmation = yield* Effect.promise(() => surviving.confirmation)
        expect(surviveConfirmation._tag).toBe('confirmed')

        // Verify state: todo-3 is from external, todo-1 is completed, todo-2 and todo-4 exist
        const todo1 = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(todo1 !== undefined)
        expect(todo1.completed).toBe(true)

        const todo3 = store.query(tables.todos.where({ id: 'todo-3' }).first())
        assert(todo3 !== undefined)
        expect(todo3.text).toBe('Theirs')

        // Verify the store is still operational after the gapped pending state.
        // If the SyncState is corrupted, this command will fail or hang.
        const postResult = store.execute(commands.createTodo({ id: 'todo-5', text: 'Post-conflict' }))
        assert(postResult._tag === 'pending')

        const postConfirmation = yield* Effect.promise(() => postResult.confirmation)
        expect(postConfirmation._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should settle all confirmations after rebase with interleaved commits and executes', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        store.commit(events.todoCreated({ id: 'seed', text: 'Seed', completed: false }))
        yield* mockSyncBackend.disconnect

        // Interleave commits and executes while disconnected
        store.commit(events.todoCreated({ id: 'todo-1', text: 'Commit-1', completed: false }))
        const exec1 = store.execute(commands.completeTodo({ id: 'seed' }))
        store.commit(events.todoCreated({ id: 'todo-2', text: 'Commit-2', completed: false }))
        const exec2 = store.execute(commands.createTodo({ id: 'todo-3', text: 'Exec-2' }))

        assert(exec1._tag === 'pending')
        assert(exec2._tag === 'pending')

        // Inject a non-conflicting external event to trigger rebase
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-ext', text: 'External', completed: false }),
        )

        yield* mockSyncBackend.connect

        // Both confirmations must resolve (not hang)
        const [conf1, conf2] = yield* Effect.all([
          Effect.promise(() => exec1.confirmation),
          Effect.promise(() => exec2.confirmation),
        ])

        expect(conf1._tag).toBe('confirmed')
        expect(conf2._tag).toBe('confirmed')

        // Verify store is fully operational afterward
        const finalResult = store.execute(commands.createTodo({ id: 'todo-final', text: 'After rebase' }))
        assert(finalResult._tag === 'pending')

        const finalConf = yield* Effect.promise(() => finalResult.confirmation)
        expect(finalConf._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should not replay already-confirmed commands on a second rebase', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })

        // --- First round: execute command, trigger rebase, confirm ---
        yield* mockSyncBackend.disconnect

        const r1 = store.execute(commands.capturePhase({ id: 'todo-1' }))
        assert(r1._tag === 'pending')

        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'ext-1', text: 'External 1', completed: false }),
        )
        yield* mockSyncBackend.connect

        const c1 = yield* Effect.promise(() => r1.confirmation).pipe(Effect.timeout('5 seconds'))
        assert(c1 !== undefined, 'first confirmation timed out')
        expect(c1._tag).toBe('confirmed')

        // After first rebase, todo-1 text should be 'replay' (handler re-executed)
        const afterFirst = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(afterFirst !== undefined)
        expect(afterFirst.text).toBe('replay')

        // --- Second round: new command, new rebase ---
        yield* mockSyncBackend.disconnect

        const r2 = store.execute(commands.createTodo({ id: 'todo-2', text: 'Second' }))
        assert(r2._tag === 'pending')

        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'ext-2', text: 'External 2', completed: false }),
        )
        yield* mockSyncBackend.connect

        const c2 = yield* Effect.promise(() => r2.confirmation).pipe(Effect.timeout('5 seconds'))
        assert(c2 !== undefined, 'second confirmation timed out')
        expect(c2._tag).toBe('confirmed')

        // todo-1 should STILL have text 'replay' — not re-replayed.
        // If the journal wasn't cleaned after the first confirmation,
        // the second rebase would replay capturePhase again, potentially
        // causing a duplicate insert error or overwriting the text.
        const afterSecond = store.query(tables.todos.where({ id: 'todo-1' }).first())
        assert(afterSecond !== undefined)
        expect(afterSecond.text).toBe('replay')
      }).pipe(withTestCtx(test)),
    )


    Vitest.scopedLive('should throw `CommandExecutionError` with `CommandHandlerThrew` reason when handler throws', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        yield* mockSyncBackend.disconnect

        // throwOnReplay succeeds on initial execution (creates a todo) but throws on replay
        const result = store.execute(commands.throwOnReplay({ id: 'todo-1' }))
        assert(result._tag === 'pending')

        // Inject an external event to trigger a rebase when we reconnect
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-2', text: 'From other client', completed: false }),
        )

        // Connect — triggers pull, rebase, and command replay.
        yield* mockSyncBackend.connect

        const outcome = yield* Effect.tryPromise({
          try: () => result.confirmation,
          catch: (err) => err as CommandExecutionError,
        }).pipe(Effect.either)

        assert(outcome._tag === 'Left')
        expect(outcome.left).toBeInstanceOf(CommandExecutionError)
        expect(outcome.left._tag).toBe('LiveStore.CommandExecutionError')
        expect(outcome.left.command.name).toBe('ThrowOnReplay')
        expect(outcome.left.reason).toBe('CommandHandlerThrew')
        expect(outcome.left.phase).toBe('replay')
        assert.instanceOf(outcome.left.cause, Error)
        expect(outcome.left.cause.message).toContain('Replay not supported')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should throw `CommandExecutionError` with `NoEventProduced` reason when handler returns empty array', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        yield* mockSyncBackend.disconnect

        // Execute createTodoIfNotExists while disconnected — succeeds (todo-1 doesn't exist yet)
        const result = store.execute(commands.createTodoIfNotExists({ id: 'todo-1', text: 'Mine' }))
        assert(result._tag === 'pending')

        // Inject an external event that creates todo-1, so replay returns [] (no events)
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'todo-1', text: 'Theirs', completed: false }),
        )

        // Connect — triggers pull, rebase, and command replay.
        // The replay of createTodoIfNotExists returns [] because todo-1 now exists.
        yield* mockSyncBackend.connect

        const outcome = yield* Effect.tryPromise({
          try: () => result.confirmation,
          catch: (err) => err as CommandExecutionError,
        }).pipe(Effect.either)

        assert(outcome._tag === 'Left')
        expect(outcome.left).toBeInstanceOf(CommandExecutionError)
        expect(outcome.left._tag).toBe('LiveStore.CommandExecutionError')
        expect(outcome.left.command.name).toBe('CreateTodoIfNotExists')
        expect(outcome.left.reason).toBe('NoEventProduced')
        expect(outcome.left.phase).toBe('replay')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should resolve mixed confirm/conflict outcomes across three or more commands', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        // Seed a todo for completeTodo to succeed
        store.commit(events.todoCreated({ id: 'seed', text: 'Seed', completed: false }))
        yield* mockSyncBackend.disconnect

        // Execute 4 commands: 1 will conflict, 3 will succeed
        const r1 = store.execute(commands.createTodoUnique({ id: 'conflict', text: 'Mine' }))
        const r2 = store.execute(commands.createTodoUnique({ id: 'safe', text: 'Safe' }))
        const r3 = store.execute(commands.completeTodo({ id: 'seed' }))
        const r4 = store.execute(commands.createTodo({ id: 'basic', text: 'Basic' }))

        assert(r1._tag === 'pending')
        assert(r2._tag === 'pending')
        assert(r3._tag === 'pending')
        assert(r4._tag === 'pending')

        // External event creates 'conflict' first
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'conflict', text: 'Theirs', completed: false }),
        )

        yield* mockSyncBackend.connect

        const c1 = yield* Effect.promise(() => r1.confirmation)
        expect(c1._tag).toBe('conflict')
        if (c1._tag === 'conflict') {
          expect(c1.error).toMatchObject({ _tag: 'TodoAlreadyExists' })
        }

        const c2 = yield* Effect.promise(() => r2.confirmation)
        expect(c2._tag).toBe('confirmed')

        const c3 = yield* Effect.promise(() => r3.confirmation)
        expect(c3._tag).toBe('confirmed')

        const c4 = yield* Effect.promise(() => r4.confirmation)
        expect(c4._tag).toBe('confirmed')

        // Verify state
        const conflict = store.query(tables.todos.where({ id: 'conflict' }).first())
        assert(conflict !== undefined)
        expect(conflict.text).toBe('Theirs')

        const safe = store.query(tables.todos.where({ id: 'safe' }).first())
        assert(safe !== undefined)

        const seed = store.query(tables.todos.where({ id: 'seed' }).first())
        assert(seed !== undefined)
        expect(seed.completed).toBe(true)

        // Store is operational
        const postResult = store.execute(commands.createTodo({ id: 'post', text: 'After' }))
        assert(postResult._tag === 'pending')
        const postConf = yield* Effect.promise(() => postResult.confirmation)
        expect(postConf._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should confirm when replay produces fewer events than initial execution', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        // Seed 3 incomplete todos
        store.commit(events.todoCreated({ id: 'todo-1', text: 'First', completed: false }))
        store.commit(events.todoCreated({ id: 'todo-2', text: 'Second', completed: false }))
        store.commit(events.todoCreated({ id: 'todo-3', text: 'Third', completed: false }))

        yield* mockSyncBackend.disconnect

        // Execute completeAllTodos — produces 3 todoCompleted events
        const result = store.execute(commands.completeAllTodos({}))
        assert(result._tag === 'pending')

        // External event completes todo-3 → replay will see only 2 incomplete todos
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCompleted.next({ id: 'todo-3' }),
        )

        yield* mockSyncBackend.connect

        // Replay produces 2 events (todo-1, todo-2) instead of 3 — command still confirms
        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('confirmed')

        // All 3 todos should be completed
        for (const id of ['todo-1', 'todo-2', 'todo-3']) {
          const todo = store.query(tables.todos.where({ id }).first())
          assert(todo !== undefined, `${id} should exist`)
          expect(todo.completed).toBe(true)
        }
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should treat a multi-event command as all-or-nothing on replay conflict', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()
        yield* mockSyncBackend.disconnect

        // Create 3 unique todos in one command
        const result = store.execute(
          commands.createMultipleTodosUnique({
            todos: [
              { id: 'a', text: 'Alpha' },
              { id: 'b', text: 'Bravo' },
              { id: 'c', text: 'Charlie' },
            ],
          }),
        )
        assert(result._tag === 'pending')

        // External event creates 'b' first → replay will fail on uniqueness check
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'b', text: 'External-B', completed: false }),
        )

        yield* mockSyncBackend.connect

        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('conflict')
        if (confirmation._tag === 'conflict') {
          expect(confirmation.error).toMatchObject({ _tag: 'TodoAlreadyExists' })
        }

        // 'b' should exist with external data
        const todoB = store.query(tables.todos.where({ id: 'b' }).first())
        assert(todoB !== undefined)
        expect(todoB.text).toBe('External-B')

        // 'a' and 'c' should NOT exist — command was all-or-nothing
        const todoA = store.query(tables.todos.where({ id: 'a' }).first())
        expect(todoA).toBeUndefined()

        const todoC = store.query(tables.todos.where({ id: 'c' }).first())
        expect(todoC).toBeUndefined()

        // Store is operational
        const postResult = store.execute(commands.createTodo({ id: 'post', text: 'After' }))
        assert(postResult._tag === 'pending')
        const postConf = yield* Effect.promise(() => postResult.confirmation)
        expect(postConf._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should not re-replay confirmed or conflicted commands across multiple rebases', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        store.commit(events.todoCreated({ id: 'seed', text: 'Seed', completed: false }))

        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })

        // --- Round 1: one command conflicts, one succeeds ---
        yield* mockSyncBackend.disconnect

        const r1 = store.execute(commands.createTodoUnique({ id: 'contested', text: 'Mine' }))
        const r2 = store.execute(commands.completeTodo({ id: 'seed' }))
        assert(r1._tag === 'pending')
        assert(r2._tag === 'pending')

        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'contested', text: 'Theirs', completed: false }),
        )
        yield* mockSyncBackend.connect

        const c1 = yield* Effect.promise(() => r1.confirmation)
        expect(c1._tag).toBe('conflict')

        const c2 = yield* Effect.promise(() => r2.confirmation)
        expect(c2._tag).toBe('confirmed')

        // --- Round 2: new command, new rebase ---
        yield* mockSyncBackend.disconnect

        const r3 = store.execute(commands.capturePhase({ id: 'phase-todo' }))
        assert(r3._tag === 'pending')

        // After Round 1's rebase, the leader pushed rebased events to the backend,
        // advancing the backend head to global 3. The event factory must produce
        // ext-2 with a seqNum > 3 so the leader's pull processing doesn't drop it
        // (the leader drops events with seqNum <= upstreamHead).
        backendFactory.todoCreated.advanceTo(4)
        yield* mockSyncBackend.advance(
          backendFactory.todoCreated.next({ id: 'ext-2', text: 'External 2', completed: false }),
        )
        yield* mockSyncBackend.connect

        const c3 = yield* Effect.promise(() => r3.confirmation).pipe(Effect.timeout('5 seconds'))
        assert(c3 !== undefined, 'third confirmation timed out')
        expect(c3._tag).toBe('confirmed')

        // Verify: r1 (conflicted) and r2 (confirmed) are not re-replayed in round 2
        const seed = store.query(tables.todos.where({ id: 'seed' }).first())
        assert(seed !== undefined)
        expect(seed.completed).toBe(true)

        const contested = store.query(tables.todos.where({ id: 'contested' }).first())
        assert(contested !== undefined)
        expect(contested.text).toBe('Theirs')

        // phase-todo was replayed in round 2
        const phaseTodo = store.query(tables.todos.where({ id: 'phase-todo' }).first())
        assert(phaseTodo !== undefined)
        expect(phaseTodo.text).toBe('replay')

        // Store is operational
        const postResult = store.execute(commands.createTodo({ id: 'final', text: 'Final' }))
        assert(postResult._tag === 'pending')
        const postConf = yield* Effect.promise(() => postResult.confirmation)
        expect(postConf._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )

    Vitest.scopedLive('should handle non-command committed events that duplicate an external event effect during rebase', (test) =>
      Effect.gen(function* () {
        const { makeStore, mockSyncBackend } = yield* TestContext
        const store = yield* makeStore()

        // Seed 2 incomplete todos
        store.commit(events.todoCreated({ id: 'shared', text: 'Shared', completed: false }))
        store.commit(events.todoCreated({ id: 'other', text: 'Other', completed: false }))

        yield* mockSyncBackend.disconnect

        // Commit non-command event completing 'shared' (idempotent UPDATE)
        store.commit(events.todoCompleted({ id: 'shared' }))
        // Execute command completing 'other'
        const result = store.execute(commands.completeTodo({ id: 'other' }))
        assert(result._tag === 'pending')

        // External event also completes 'shared' — same effect, idempotent
        const backendFactory = EventFactory.makeFactory(events)({
          client: EventFactory.clientIdentity('other-client'),
        })
        yield* mockSyncBackend.advance(
          backendFactory.todoCompleted.next({ id: 'shared' }),
        )

        yield* mockSyncBackend.connect

        // Command for 'other' should confirm
        const confirmation = yield* Effect.promise(() => result.confirmation)
        expect(confirmation._tag).toBe('confirmed')

        // Both todos should be completed
        const shared = store.query(tables.todos.where({ id: 'shared' }).first())
        assert(shared !== undefined)
        expect(shared.completed).toBe(true)

        const other = store.query(tables.todos.where({ id: 'other' }).first())
        assert(other !== undefined)
        expect(other.completed).toBe(true)

        // Store is operational
        const postResult = store.execute(commands.createTodo({ id: 'post', text: 'After' }))
        assert(postResult._tag === 'pending')
        const postConf = yield* Effect.promise(() => postResult.confirmation)
        expect(postConf._tag).toBe('confirmed')
      }).pipe(withTestCtx(test)),
    )
  })
})

/**
 * The purpose of this test is a store integration test for event streaming.
 * Main test covering event streaming logic itself is located in:
 * tests/package-common/src/leader-thread/stream-events.test.ts
 */
Vitest.describe('store.eventsStream', () => {
  Vitest.scopedLive('should resume when reconnected to sync backend', (test) =>
    Effect.gen(function* () {
      const { makeStore, mockSyncBackend } = yield* TestContext
      const store = yield* makeStore()
      yield* mockSyncBackend.connect

      const eventFactory = EventFactory.makeFactory(events)({
        client: EventFactory.clientIdentity('other-client', 'static-session-id'),
      })

      // Queue is used in order to allow analyzing the stream in stages
      const eventsQueue = yield* Queue.unbounded<LiveStoreEvent.Client.ForSchema<typeof schema>>()

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
