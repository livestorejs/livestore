import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { sql } from '@livestore/common'
import { rawSqlEvent } from '@livestore/common/schema'
import { queryDb, type Store } from '@livestore/livestore'
import { Schema } from '@livestore/utils/effect'
import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { describe, expect, it } from 'vitest'

import { schema, tables } from './__tests__/fixture.js'
import { LiveStoreProvider } from './LiveStoreProvider.js'
import * as LiveStoreReact from './mod.js'

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
        (store: Store) =>
          store.commit(
            rawSqlEvent({
              sql: sql`INSERT OR IGNORE INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
            }),
          ),
        [],
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const { rerender } = render(<Root forceUpdate={1} />)

    expect(appRenderCount).toBe(0)

    await waitForElementToBeRemoved(() => screen.getByText((_) => _.startsWith('Loading LiveStore')))

    expect(appRenderCount).toBe(strictMode ? 2 : 1)

    rerender(<Root forceUpdate={2} />)

    await waitFor(() => screen.getByText('Loading LiveStore: loading'))
    await waitFor(() => screen.getByText((_) => _.includes('buy milk')))

    expect(appRenderCount).toBe(strictMode ? 4 : 2)

    abortController.abort()

    await waitFor(() => screen.getByText('LiveStore Shutdown due to interrupted', { exact: false }))
  })

  // TODO test aborting during boot

  it('error during boot', async () => {
    let appRenderCount = 0

    const App = () => {
      appRenderCount++

      return <div>hello world</div>
    }

    const Root = ({ forceUpdate }: { forceUpdate: number }) => {
      const bootCb = React.useCallback(
        (store: Store) =>
          store.commit(
            rawSqlEvent({
              sql: sql`INSERT OR IGNORE INTO todos_missing_table (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
            }),
          ),
        [],
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

    render(<Root forceUpdate={1} />)

    expect(appRenderCount).toBe(0)

    await waitFor(() => screen.getByText((_) => _.startsWith('LiveStore.UnexpectedError')))
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

    render(<Root />)

    expect(appRenderCount).toBe(0)

    await waitFor(() => screen.getByText('[]'))

    React.act(() => shutdownDeferred.resolve())

    expect(appRenderCount).toBe(strictMode ? 2 : 1)

    await waitFor(() => screen.getByText('LiveStore Shutdown due to manual shutdown', { exact: false }))
  })
})
