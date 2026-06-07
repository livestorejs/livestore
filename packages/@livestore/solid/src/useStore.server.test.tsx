/**
 * SSR tests for useStore
 * These tests run in node environment with SSR JSX transform using renderToString.
 */

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { provideOtel } from '@livestore/common'
import { createStore } from '@livestore/livestore'
import { Effect } from '@livestore/utils/effect'
import { isServer, renderToString } from 'solid-js/web'
import { describe, expect, it } from 'vitest'

import { schema, tables } from './__tests__/fixture.tsx'
import { withSolidApi } from './useStore.ts'

describe('environment', () => {
  it('runs on server', () => {
    // Use 'window' in globalThis to avoid TypeScript error without DOM lib
    expect('window' in globalThis).toBe(false)
    expect(isServer).toBe(true)
  })
})

describe('useStore SSR', () => {
  it('renders component with pre-created store to string', async () => {
    await Effect.gen(function* () {
      const store = yield* createStore({
        schema,
        storeId: 'ssr-store-test',
        adapter: makeInMemoryAdapter(),
        debug: { instanceId: 'ssr-store-test' },
      })

      const storeWithSolidApi = withSolidApi(store)

      const StoreStatus = () => {
        return <div>Store ID: {storeWithSolidApi.storeId}</div>
      }

      const html = renderToString(() => <StoreStatus />)

      expect(html).toContain('Store ID:')
      expect(html).toContain('ssr-store-test')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })

  it('renders component using store queries to string', async () => {
    await Effect.gen(function* () {
      const store = yield* createStore({
        schema,
        storeId: 'ssr-store-query-test',
        adapter: makeInMemoryAdapter(),
        debug: { instanceId: 'ssr-store-query-test' },
      })

      const storeWithSolidApi = withSolidApi(store)

      const [state] = storeWithSolidApi.useClientDocument(tables.userInfo, 'u1')

      const UserInfo = () => {
        return <div>User: {state().username || 'anonymous'}</div>
      }

      const html = renderToString(() => <UserInfo />)

      expect(html).toContain('User:')
    }).pipe(provideOtel({}), Effect.scoped, Effect.runPromise)
  })
})
