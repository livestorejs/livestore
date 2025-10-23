/** biome-ignore-all lint/a11y: test files need a11y disabled */
import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { queryDb, type Store } from '@livestore/livestore'
import { Schema } from '@livestore/utils/effect'
import * as ReactTesting from '@testing-library/react'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { describe, expect, it } from 'vitest'

import { events, schema, tables } from './__tests__/fixture.tsx'
import { LiveStoreProvider } from './LiveStoreProvider.tsx'
import * as LiveStoreReact from './mod.ts'

describe.each([true, false])('LiveStoreProvider (strictMode: %s)', (strictMode) => {
  const WithStrictMode = strictMode ? React.StrictMode : React.Fragment

  it('simple', async () => {
    let appRenderCount = 0

    const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

    const App = () => {
      appRenderCount++
      const { store } = LiveStoreReact.useStore()

      const todos = store.useQuery(allTodos$)

      return <div>{JSON.stringify(todos)}</div>
    }

    const abortController = new AbortController()

    const Root = ({ forceUpdate }: { forceUpdate: number }) => {
      const bootCb = React.useCallback(
        (store: Store) => store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false })),
        [],
      )

      // biome-ignore lint/correctness/useExhaustiveDependencies: forceUpdate is used to force a re-render
      const adapterMemo = React.useMemo(() => makeInMemoryAdapter(), [forceUpdate])
      return (
        <WithStrictMode>
          <LiveStoreProvider
            schema={schema}
            renderLoading={(status) => <div>Loading LiveStore: {status.stage}</div>}
            adapter={adapterMemo}
            boot={bootCb}
            signal={abortController.signal}
            batchUpdates={batchUpdates}
          >
            <App />
          </LiveStoreProvider>
        </WithStrictMode>
      )
    }

    const { rerender } = ReactTesting.render(<Root forceUpdate={1} />)

    expect(appRenderCount).toBe(0)

    await ReactTesting.waitForElementToBeRemoved(() =>
      ReactTesting.screen.getByText((_) => _.startsWith('Loading LiveStore')),
    )

    expect(appRenderCount).toBe(strictMode ? 2 : 1)

    rerender(<Root forceUpdate={2} />)

    await ReactTesting.waitFor(() => ReactTesting.screen.getByText('Loading LiveStore: loading'))
    await ReactTesting.waitFor(() => ReactTesting.screen.getByText((_) => _.includes('buy milk')))

    expect(appRenderCount).toBe(strictMode ? 4 : 2)

    abortController.abort()

    await ReactTesting.waitFor(() =>
      ReactTesting.screen.getByText('LiveStore Shutdown due to interrupted', { exact: false }),
    )
  })

  // TODO test aborting during boot

  it('error during boot', async () => {
    let appRenderCount = 0

    const App = () => {
      appRenderCount++

      return <div>hello world</div>
    }

    const Root = ({ forceUpdate }: { forceUpdate: number }) => {
      const bootCb = React.useCallback((_store: Store) => {
        // This should trigger an error because we're trying to insert invalid data
        throw new Error('Simulated boot error')
      }, [])
      // biome-ignore lint/correctness/useExhaustiveDependencies: forceUpdate is used to force a re-render
      const adapterMemo = React.useMemo(() => makeInMemoryAdapter(), [forceUpdate])
      return (
        <WithStrictMode>
          <LiveStoreProvider
            schema={schema}
            renderLoading={(status) => <div>Loading LiveStore: {status.stage}</div>}
            adapter={adapterMemo}
            boot={bootCb}
            batchUpdates={batchUpdates}
          >
            <App />
          </LiveStoreProvider>
        </WithStrictMode>
      )
    }

    ReactTesting.render(<Root forceUpdate={1} />)

    expect(appRenderCount).toBe(0)

    await ReactTesting.waitFor(() => ReactTesting.screen.getByText((_) => _.startsWith('LiveStore.UnexpectedError')))
  })

  it('unmounts when store is shutdown', async () => {
    let appRenderCount = 0

    const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

    const shutdownDeferred = Promise.withResolvers<void>()

    const App = () => {
      appRenderCount++
      const { store } = LiveStoreReact.useStore()

      React.useEffect(() => {
        shutdownDeferred.promise.then(() => {
          console.log('shutdown')
          return store.shutdown()
        })
      }, [store])

      const todos = store.useQuery(allTodos$)

      return <div>{JSON.stringify(todos)}</div>
    }

    const adapter = makeInMemoryAdapter()

    const Root = () => {
      return (
        <WithStrictMode>
          <LiveStoreProvider
            schema={schema}
            renderLoading={(status) => <div>Loading LiveStore: {status.stage}</div>}
            adapter={adapter}
            batchUpdates={batchUpdates}
          >
            <App />
          </LiveStoreProvider>
        </WithStrictMode>
      )
    }

    ReactTesting.render(<Root />)

    expect(appRenderCount).toBe(0)

    await ReactTesting.waitFor(() => ReactTesting.screen.getByText('[]'))

    React.act(() => shutdownDeferred.resolve())

    expect(appRenderCount).toBe(strictMode ? 2 : 1)

    await ReactTesting.waitFor(() =>
      ReactTesting.screen.getByText('LiveStore Shutdown due to manual shutdown', { exact: false }),
    )
  })
})

it('should work two stores with the same storeId', async () => {
  const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

  const appRenderCount = {
    store1: 0,
    store2: 0,
  }

  const App = () => {
    const { store } = LiveStoreReact.useStore()
    const instanceId = store.clientSession.debugInstanceId as 'store1' | 'store2'
    appRenderCount[instanceId]!++

    const todos = store.useQuery(allTodos$)

    return (
      <div id={instanceId}>
        <div role="heading">{instanceId}</div>
        <div role="content">{JSON.stringify(todos)}</div>
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
          batchUpdates={batchUpdates}
        >
          <App />
        </LiveStoreProvider>
        <LiveStoreProvider
          storeId={storeId}
          debug={{ instanceId: 'store2' }}
          schema={schema}
          adapter={makeInMemoryAdapter()}
          batchUpdates={batchUpdates}
        >
          <App />
        </LiveStoreProvider>
      </div>
    )
  }

  const { container } = ReactTesting.render(<Root />)

  await ReactTesting.waitFor(() => ReactTesting.screen.getByRole('heading', { name: 'store1' }))
  await ReactTesting.waitFor(() => ReactTesting.screen.getByRole('heading', { name: 'store2' }))

  expect(appRenderCount.store1).toBe(1)
  expect(appRenderCount.store2).toBe(1)

  ReactTesting.fireEvent.click(ReactTesting.screen.getByText('create todo store1'))

  expect(appRenderCount.store1).toBe(2)

  expect(container.querySelector('#store1 > div[role="content"]')?.textContent).toBe(
    '[{"id":"t1","text":"buy milk","completed":false}]',
  )

  expect(container.querySelector('#store2 > div[role="content"]')?.textContent).toBe('[]')
})

// TODO test that checks that there are no two exact same instances (i.e. same storeId, clientId, sessionId)
