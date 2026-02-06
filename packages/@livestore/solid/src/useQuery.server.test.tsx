/**
 * SSR tests for useQuery
 * These tests run in node environment with SSR JSX transform using renderToString.
 */

import { provideOtel } from '@livestore/common'
import { queryDb, signal } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import { isServer, renderToString } from 'solid-js/web'
import { describe, expect, it } from 'vitest'

import { events, makeTodoMvcSolid, tables } from './__tests__/fixture.tsx'

describe('environment', () => {
  it('runs on server', () => {
    // Use 'window' in globalThis to avoid TypeScript error without DOM lib
    expect('window' in globalThis).toBe(false)
    expect(isServer).toBe(true)
  })
})

describe('useQuery SSR', () => {
  it('renders simple query result to string', async () => {
    await Effect.gen(function* () {
      const { store } = yield* makeTodoMvcSolid({})

      store.commit(events.todoCreated({ id: 't1', text: 'SSR Todo', completed: false }))

      const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

      const TodoList = () => {
        const todos = store.useQuery(allTodos$)
        return (
          <ul>
            {todos()?.map((todo) => (
              <li>{todo.text}</li>
            ))}
          </ul>
        )
      }

      const html = renderToString(() => <TodoList />)

      expect(html).toContain('SSR Todo')
      expect(html).toContain('<ul')
      expect(html).toContain('<li')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders filtered dependency query to string', async () => {
    await Effect.gen(function* () {
      const { store } = yield* makeTodoMvcSolid({})

      const filter$ = signal('t1', { label: 'id-filter' })
      const todo$ = queryDb((get) => tables.todos.where('id', get(filter$)), { label: 'todo' })

      store.commit(
        events.todoCreated({ id: 't1', text: 'buy milk', completed: false }),
        events.todoCreated({ id: 't2', text: 'buy eggs', completed: false }),
      )

      const TodoItem = () => {
        const query = store.useQuery(todo$)
        return <div>{query()?.[0]?.text ?? 'No todo'}</div>
      }

      const html = renderToString(() => <TodoItem />)

      expect(html).toContain('buy milk')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders signal query to string', async () => {
    await Effect.gen(function* () {
      const { store } = yield* makeTodoMvcSolid({})
      const num$ = signal(42)

      const Counter = () => {
        const count = store.useQuery(num$)
        return <div>Count: {count()}</div>
      }

      const html = renderToString(() => <Counter />)

      expect(html).toContain('Count:')
      expect(html).toContain('42')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders multiple todos to string', async () => {
    await Effect.gen(function* () {
      const { store } = yield* makeTodoMvcSolid({})

      store.commit(
        events.todoCreated({ id: 't1', text: 'First', completed: false }),
        events.todoCreated({ id: 't2', text: 'Second', completed: true }),
        events.todoCreated({ id: 't3', text: 'Third', completed: false }),
      )

      const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

      const App = () => {
        const todos = store.useQuery(allTodos$)
        return (
          <div>
            <h1>Todo App</h1>
            <p>Count: {todos()?.length}</p>
            <ul>
              {todos()?.map((todo) => (
                <li>{todo.text}</li>
              ))}
            </ul>
          </div>
        )
      }

      const html = renderToString(() => <App />)

      expect(html).toContain('Todo App')
      expect(html).toContain('Count:')
      expect(html).toContain('3')
      expect(html).toContain('First')
      expect(html).toContain('Second')
      expect(html).toContain('Third')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })
})
