import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'

import { events, makeTodoMvc, tables } from '../utils/tests/fixture.ts'

Vitest.describe('Store commit API', () => {
  Vitest.live('should materialize events emitted by the documented commit callback', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const firstTodo = { id: '1', text: 'Make coffee', completed: false }
      const secondTodo = { id: '2', text: 'Buy groceries', completed: false }

      // Regression for https://github.com/livestorejs/livestore/issues/1611.
      store.commit((commit) => {
        commit(events.todoCreated(firstTodo))
        commit(events.todoCreated(secondTodo))
        expect(store.query(tables.todos)).toEqual([])
      })

      expect(store.query(tables.todos.orderBy('id', 'asc'))).toEqual([firstTodo, secondTodo])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should materialize a single callback event', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const todo = { id: '1', text: 'Make coffee', completed: false }

      store.commit((commit) => commit(events.todoCreated(todo)))

      expect(store.query(tables.todos)).toEqual([todo])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should accept an empty callback', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()

      store.commit(() => {})

      expect(store.query(tables.todos)).toEqual([])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should discard collected events when the callback throws', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const todo = { id: '1', text: 'Make coffee', completed: false }
      const error = new Error('Callback failed')

      expect(() =>
        store.commit((commit) => {
          commit(events.todoCreated(todo))
          throw error
        }),
      ).toThrow(error)

      expect(store.query(tables.todos)).toEqual([])
      store.commit(events.todoCreated(todo))
      expect(store.query(tables.todos)).toEqual([todo])
    }).pipe(Effect.scoped),
  )

  Vitest.live('should collect multiple event types in one emitter call in order', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const todo = { id: '1', text: 'Make coffee', completed: false }

      store.commit((commit) => {
        commit(events.todoCreated(todo), events.todoCompleted({ id: todo.id }))
      })

      expect(store.query(tables.todos)).toEqual([{ ...todo, completed: true }])
    }).pipe(Effect.scoped),
  )

  for (const options of [{}, { label: 'Create todo' }]) {
    Vitest.live(`should accept callback options ${JSON.stringify(options)}`, () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc()
        const todo = { id: '1', text: 'Make coffee', completed: false }

        store.commit(options, (commit) => commit(events.todoCreated(todo)))

        expect(store.query(tables.todos)).toEqual([todo])
      }).pipe(Effect.scoped),
    )
  }

  Vitest.live('should ignore callback return values and only commit emitted events', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()
      const todo = { id: '1', text: 'Make coffee', completed: false }

      store.commit(() => [events.todoCreated(todo)])
      expect(store.query(tables.todos)).toEqual([])

      store.commit((commit) => {
        commit(events.todoCreated(todo))
        return [events.todoCompleted({ id: todo.id })]
      })

      expect(store.query(tables.todos)).toEqual([todo])
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
