/**
 * SSR tests for useClientDocument
 * These tests run in node environment with SSR JSX transform using renderToString.
 */

import { provideOtel } from '@livestore/common'
import * as LiveStore from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import { isServer, renderToString } from 'solid-js/web'
import { describe, expect, it } from 'vitest'

import { events, makeTodoMvcSolid, tables } from './__tests__/fixture.tsx'

describe('environment', () => {
  it('runs on server', () => {
    expect(typeof window).toBe('undefined')
    expect(isServer).toBe(true)
  })
})

describe('useClientDocument SSR', () => {
  it('renders client document with default value to string', async () => {
    await Effect.gen(function* () {
      const { store } = yield* makeTodoMvcSolid({})

      const UserDisplay = () => {
        const [state] = store.useClientDocument(tables.userInfo, 'u1')
        return <div>Username: {state().username || 'anonymous'}</div>
      }

      const html = renderToString(() => <UserDisplay />)

      expect(html).toContain('Username:')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders client document with committed value to string', async () => {
    await Effect.gen(function* () {
      const { store } = yield* makeTodoMvcSolid({})

      store.commit(events.UserInfoSet({ username: 'ssr-user' }, 'u1'))

      const UserDisplay = () => {
        const [state] = store.useClientDocument(tables.userInfo, 'u1')
        return <div>Username: {state().username}</div>
      }

      const html = renderToString(() => <UserDisplay />)

      expect(html).toContain('Username:')
      expect(html).toContain('ssr-user')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders larger app with useClientDocument and useQuery to string', async () => {
    await Effect.gen(function* () {
      const { store } = yield* makeTodoMvcSolid({})

      const allTodos$ = LiveStore.queryDb(
        { query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) },
        { label: 'allTodos' },
      )

      store.commit(
        events.todoCreated({ id: 't1', text: 'buy milk', completed: false }),
        events.todoCreated({ id: 't2', text: 'buy eggs', completed: true }),
      )

      const App = () => {
        const [routerState] = store.useClientDocument(tables.AppRouterSchema, 'singleton')
        const allTodos = store.useQuery(allTodos$)

        return (
          <div>
            <div>Current Task: {routerState().currentTaskId ?? 'none'}</div>
            <div>Total Tasks: {allTodos()?.length}</div>
          </div>
        )
      }

      const html = renderToString(() => <App />)

      expect(html).toContain('Current Task:')
      expect(html).toContain('none')
      expect(html).toContain('Total Tasks:')
      expect(html).toContain('2')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders kv client document to string', async () => {
    await Effect.gen(function* () {
      const { store } = yield* makeTodoMvcSolid({})

      const KVDisplay = () => {
        const [state] = store.useClientDocument(tables.kv, 'k1')
        return <div>Value: {JSON.stringify(state())}</div>
      }

      const html = renderToString(() => <KVDisplay />)

      expect(html).toContain('Value:')
      expect(html).toContain('null')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })
})
