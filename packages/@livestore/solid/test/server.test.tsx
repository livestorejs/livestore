/**
 * SSR tests for @livestore/solid
 * These tests run in node environment with SSR JSX transform.
 * Following pattern from https://github.com/solidjs-community/solid-lib-starter
 */

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { provideOtel } from '@livestore/common'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { createStore, queryDb } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import { isServer, renderToString } from 'solid-js/web'

import * as LiveStoreSolid from '../src/mod.ts'

// Simple schema for SSR tests
const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '', nullable: false }),
  },
})

const userInfo = State.SQLite.clientDocument({
  name: 'UserInfo',
  schema: Schema.Struct({
    username: Schema.String,
  }),
  default: { value: { username: 'default-user' } },
})

const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
  UserInfoSet: userInfo.set,
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text }) => todos.insert({ id, text }),
})

const tables = { todos, userInfo }
const state = State.SQLite.makeState({ tables, materializers })
const schema = makeSchema({ state, events })

describe('environment', () => {
  it('runs on server', () => {
    expect(typeof window).toBe('undefined')
    expect(isServer).toBe(true)
  })
})

describe('SSR rendering', () => {
  it('renders useQuery hook result to string', async () => {
    await Effect.gen(function* () {
      const store = yield* createStore({
        schema,
        storeId: 'ssr-test',
        adapter: makeInMemoryAdapter(),
        debug: { instanceId: 'ssr-test' },
      })

      const storeWithSolidApi = LiveStoreSolid.withSolidApi(store)

      // Add some data
      store.commit(events.todoCreated({ id: 't1', text: 'SSR Todo' }))

      const allTodos$ = queryDb({
        query: `select * from todos`,
        schema: Schema.Array(tables.todos.rowSchema),
      })

      const TodoList = () => {
        const todos = storeWithSolidApi.useQuery(allTodos$)
        return (
          <ul>
            {todos().map((todo) => (
              <li>{todo.text}</li>
            ))}
          </ul>
        )
      }

      const html = renderToString(() => <TodoList />)

      expect(html).toContain('SSR Todo')
      expect(html).toContain('<ul>')
      expect(html).toContain('<li>')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders useClientDocument hook result to string', async () => {
    await Effect.gen(function* () {
      const store = yield* createStore({
        schema,
        storeId: 'ssr-test-2',
        adapter: makeInMemoryAdapter(),
        debug: { instanceId: 'ssr-test-2' },
      })

      const storeWithSolidApi = LiveStoreSolid.withSolidApi(store)

      const UserDisplay = () => {
        const [state] = storeWithSolidApi.useClientDocument(tables.userInfo, 'u1')
        return <div>User: {state().username}</div>
      }

      const html = renderToString(() => <UserDisplay />)

      expect(html).toContain('User:')
      expect(html).toContain('default-user')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders component with store context to string', async () => {
    await Effect.gen(function* () {
      const store = yield* createStore({
        schema,
        storeId: 'ssr-test-3',
        adapter: makeInMemoryAdapter(),
        debug: { instanceId: 'ssr-test-3' },
      })

      const storeWithSolidApi = LiveStoreSolid.withSolidApi(store)

      // Add data before rendering
      store.commit(events.todoCreated({ id: 't1', text: 'First' }))
      store.commit(events.todoCreated({ id: 't2', text: 'Second' }))

      const allTodos$ = queryDb({
        query: `select * from todos`,
        schema: Schema.Array(tables.todos.rowSchema),
      })

      const App = () => {
        const todos = storeWithSolidApi.useQuery(allTodos$)
        return (
          <div>
            <h1>Todo App</h1>
            <p>Count: {todos().length}</p>
          </div>
        )
      }

      const html = renderToString(() => <App />)

      expect(html).toContain('Todo App')
      expect(html).toContain('Count:')
      expect(html).toContain('2')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })
})
