/** biome-ignore-all lint/a11y: test files need a11y disabled */
import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { queryDb, type Store } from '@livestore/livestore'
import { Schema } from '@livestore/utils/effect'
import * as SolidTesting from '@solidjs/testing-library'
import { createMemo, onMount } from 'solid-js'
import { describe, expect, it } from 'vitest'

import { events, schema, tables } from './__tests__/fixture.js'
import { LiveStoreProvider } from './LiveStoreProvider.js'
import * as LiveStoreSolid from './mod.js'

describe('LiveStoreProvider', () => {
  it('simple', async () => {
    let appRenderCount = 0

    const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

    const App = () => {
      appRenderCount++
      const { store } = LiveStoreSolid.useStore()

      const todos = store.useQuery(() => allTodos$)

      return <div>{JSON.stringify(todos())}</div>
    }

    const abortController = new AbortController()

    SolidTesting.render(() => {
      const bootCb = (store: Store) =>
        store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))

      const adapter = createMemo(() => makeInMemoryAdapter())
      return (
        <LiveStoreProvider
          schema={schema}
          renderLoading={(status) => <div>Loading LiveStore: {status.stage}</div>}
          adapter={adapter()}
          boot={bootCb}
          signal={abortController.signal}
        >
          <App />
        </LiveStoreProvider>
      )
    })

    expect(appRenderCount).toBe(0)

    await SolidTesting.waitForElementToBeRemoved(
      () => SolidTesting.screen.getByText((_) => _.startsWith('Loading LiveStore')),
      { timeout: 1_000 },
    )
    await SolidTesting.waitFor(() => SolidTesting.screen.getByText((_) => _.includes('buy milk')))

    abortController.abort()

    await SolidTesting.waitFor(() =>
      SolidTesting.screen.getByText('LiveStore Shutdown due to interrupted', { exact: false }),
    )
  })

  // TODO test aborting during boot

  it('error during boot', async () => {
    let appRenderCount = 0

    const App = () => {
      appRenderCount++

      return <div>hello world</div>
    }

    const Root = () => {
      const bootCb = (_store: Store) => {
        // This should trigger an error because we're trying to insert invalid data
        throw new Error('Simulated boot error')
      }
      const adapterMemo = createMemo(() => makeInMemoryAdapter())
      return (
        <LiveStoreProvider
          schema={schema}
          renderLoading={(status) => <div>Loading LiveStore: {status.stage}</div>}
          adapter={adapterMemo()}
          boot={bootCb}
        >
          <App />
        </LiveStoreProvider>
      )
    }

    SolidTesting.render(() => <Root />)

    expect(appRenderCount).toBe(0)

    await SolidTesting.waitFor(() => SolidTesting.screen.getByText((_) => _.startsWith('LiveStore.UnexpectedError')))
  })

  it('unmounts when store is shutdown', async () => {
    let appRenderCount = 0

    const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

    const shutdownDeferred = Promise.withResolvers<void>()

    const App = () => {
      appRenderCount++
      const { store } = LiveStoreSolid.useStore()

      onMount(() => {
        shutdownDeferred.promise.then(() => {
          console.log('shutdown')
          return store.shutdown()
        })
      })

      const todos = store.useQuery(() => allTodos$)

      return <div>{JSON.stringify(todos())}</div>
    }

    const adapter = makeInMemoryAdapter()

    const Root = () => {
      return (
        <LiveStoreProvider
          schema={schema}
          renderLoading={(status) => <div>Loading LiveStore: {status.stage}</div>}
          adapter={adapter}
        >
          <App />
        </LiveStoreProvider>
      )
    }

    SolidTesting.render(() => <Root />)

    expect(appRenderCount).toBe(0)

    await SolidTesting.waitFor(() => SolidTesting.screen.getByText('[]'))

    shutdownDeferred.resolve()

    expect(appRenderCount).toBe(1)

    await SolidTesting.waitFor(() =>
      SolidTesting.screen.getByText('LiveStore Shutdown due to manual shutdown', { exact: false }),
    )
  })

  it('should work two stores with the same storeId', async () => {
    const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

    const appRenderCount = {
      store1: 0,
      store2: 0,
    }

    const App = () => {
      const { store } = LiveStoreSolid.useStore()
      const instanceId = store.clientSession.debugInstanceId as 'store1' | 'store2'
      appRenderCount[instanceId]!++

      const todos = store.useQuery(() => allTodos$)

      return (
        <div id={instanceId}>
          <div role="heading">{instanceId}</div>
          <div role="content">{JSON.stringify(todos())}</div>
          <button onClick={() => store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))}>
            create todo {instanceId}
          </button>
        </div>
      )
    }

    const Root = () => {
      const storeId = 'fixed-store-id'
      return (
        <div>
          <LiveStoreProvider
            storeId={storeId}
            debug={{ instanceId: 'store1' }}
            schema={schema}
            adapter={makeInMemoryAdapter()}
          >
            <App />
          </LiveStoreProvider>
          <LiveStoreProvider
            storeId={storeId}
            debug={{ instanceId: 'store2' }}
            schema={schema}
            adapter={makeInMemoryAdapter()}
          >
            <App />
          </LiveStoreProvider>
        </div>
      )
    }

    const { container } = SolidTesting.render(() => <Root />)

    await SolidTesting.waitFor(() => SolidTesting.screen.getByRole('heading', { name: 'store1' }))
    await SolidTesting.waitFor(() => SolidTesting.screen.getByRole('heading', { name: 'store2' }))

    expect(appRenderCount.store1).toBe(1)
    expect(appRenderCount.store2).toBe(1)

    SolidTesting.fireEvent.click(SolidTesting.screen.getByText('create todo store1'))

    expect(container.querySelector('#store1 > div[role="content"]')?.textContent).toBe(
      '[{"id":"t1","text":"buy milk","completed":false}]',
    )

    expect(container.querySelector('#store2 > div[role="content"]')?.textContent).toBe('[]')
  })
})

// TODO test that checks that there are no two exact same instances (i.e. same storeId, clientId, sessionId)
