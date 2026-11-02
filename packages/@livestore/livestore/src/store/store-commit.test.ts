import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'

import { events, makeTodoMvc, tables } from '../utils/tests/fixture.ts'

Vitest.describe('Store commit API', () => {
  Vitest.live('should materialize events returned by the commit callback', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const firstTodo = { id: '1', text: 'Make coffee', completed: false }
      const secondTodo = { id: '2', text: 'Buy groceries', completed: false }

      // Regression for https://github.com/livestorejs/livestore/issues/1611.
      store.commit(() => {
        expect(store.query(tables.todos)).toEqual([])
        return [events.todoCreated(firstTodo), events.todoCreated(secondTodo)]
      })

      expect(store.query(tables.todos.orderBy('id', 'asc'))).toEqual([firstTodo, secondTodo])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should materialize a single callback event', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const todo = { id: '1', text: 'Make coffee', completed: false }
      const batch = [events.todoCreated(todo)] as const

      store.commit(() => batch)

      expect(store.query(tables.todos)).toEqual([todo])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should accept an empty callback', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()

      store.commit(() => [])

      expect(store.query(tables.todos)).toEqual([])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should apply no events when the callback throws', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const todo = { id: '1', text: 'Make coffee', completed: false }
      const error = new Error('Callback failed')

      expect(() =>
        store.commit(() => {
          throw error
        }),
      ).toThrow(error)

      expect(store.query(tables.todos)).toEqual([])
      store.commit(events.todoCreated(todo))
      expect(store.query(tables.todos)).toEqual([todo])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should commit multiple returned event types in order', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const todo = { id: '1', text: 'Make coffee', completed: false }

      store.commit(() => [events.todoCreated(todo), events.todoCompleted({ id: todo.id })])

      expect(store.query(tables.todos)).toEqual([{ ...todo, completed: true }])
    }).pipe(Effect.scoped),
  )

  for (const options of [{}, { label: 'Create todo' }]) {
    Vitest.live(`should accept callback options ${JSON.stringify(options)}`, () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc()
        const todo = { id: '1', text: 'Make coffee', completed: false }

        store.commit(options, () => [events.todoCreated(todo)])

        expect(store.query(tables.todos)).toEqual([todo])
      }).pipe(Effect.scoped),
    )
  }

  Vitest.live('should reject callback values that are not event arrays', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()

      expect(() => Reflect.apply(store.commit, store, [() => undefined])).toThrow(
        'store.commit callback must synchronously return an array of events',
      )
      expect(() => Reflect.apply(store.commit, store, [() => Promise.resolve([])])).toThrow(
        'store.commit callback must synchronously return an array of events',
      )

      expect(store.query(tables.todos)).toEqual([])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should reject non-array and asynchronous callbacks at the type level', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()

      // Keep invalid calls uninvoked so TypeScript checks the public overloads without executing them.
      const assertRejectedCallbackTypes = () => {
        // @ts-expect-error Commit callbacks must return an event array.
        store.commit(() => {})
        // @ts-expect-error Commit callbacks do not receive an event emitter.
        store.commit((emit: () => void) => {
          emit()
          return []
        })
        // @ts-expect-error Commit callbacks must be synchronous.
        store.commit(async () => [])
      }

      expect(assertRejectedCallbackTypes).toBeTypeOf('function')
    }).pipe(Effect.scoped),
  )

  Vitest.live('should still accept direct events with options and no events', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const todo = { id: '1', text: 'Make coffee', completed: false }

      store.commit()
      store.commit({ label: 'Empty commit' })
      store.commit({ label: 'Create and complete' }, events.todoCreated(todo), events.todoCompleted({ id: todo.id }))

      expect(store.query(tables.todos)).toEqual([{ ...todo, completed: true }])
    }).pipe(Effect.scoped),
  )
})
