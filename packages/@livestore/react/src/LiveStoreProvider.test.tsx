import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { sql } from '@livestore/common'
import { rawSqlMutation } from '@livestore/common/schema'
import { queryDb, type Store } from '@livestore/livestore'
import { Schema } from '@livestore/utils/effect'
import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { describe, expect, it } from 'vitest'

import { schema, tables } from './__tests__/fixture.js'
import { LiveStoreProvider } from './LiveStoreProvider.js'
import * as LiveStoreReact from './mod.js'

describe('LiveStoreProvider', () => {
  it('simple', async () => {
    let appRenderCount = 0

    const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.schema) })

    const App = () => {
      appRenderCount++

      const todos = LiveStoreReact.useQuery(allTodos$)

      return <div>{JSON.stringify(todos)}</div>
    }

    const abortController = new AbortController()

    const Root = ({ forceUpdate }: { forceUpdate: number }) => {
      const bootCb = React.useCallback(
        (store: Store) =>
          store.mutate(
            rawSqlMutation({
              sql: sql`INSERT OR IGNORE INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
            }),
          ),
        [],
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const adapterMemo = React.useMemo(() => makeInMemoryAdapter(), [forceUpdate])
      return (
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
      )
    }

    const { rerender } = render(<Root forceUpdate={1} />)

    expect(appRenderCount).toBe(0)

    await waitForElementToBeRemoved(() => screen.getByText((_) => _.startsWith('Loading LiveStore')))

    expect(appRenderCount).toBe(1)

    rerender(<Root forceUpdate={2} />)

    await waitFor(() => screen.getByText('Loading LiveStore: loading'))
    await waitFor(() => screen.getByText((_) => _.includes('buy milk')))

    expect(appRenderCount).toBe(2)

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
          store.mutate(
            rawSqlMutation({
              sql: sql`INSERT OR IGNORE INTO todos_missing_table (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
            }),
          ),
        [],
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const adapterMemo = React.useMemo(() => makeInMemoryAdapter(), [forceUpdate])
      return (
        <LiveStoreProvider
          schema={schema}
          renderLoading={(status) => <div>Loading LiveStore: {status.stage}</div>}
          adapter={adapterMemo}
          boot={bootCb}
          batchUpdates={batchUpdates}
        >
          <App />
        </LiveStoreProvider>
      )
    }

    render(<Root forceUpdate={1} />)

    expect(appRenderCount).toBe(0)

    await waitFor(() => screen.getByText((_) => _.startsWith('LiveStore.UnexpectedError')))
  })
})
