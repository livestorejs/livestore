import type { BootDb } from '@livestore/common'
import { sql } from '@livestore/common'
import { Schema } from '@livestore/utils/effect'
import { makeInMemoryAdapter } from '@livestore/web'
import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { schema, tables } from '../__tests__/react/fixture.js'
import { querySQL } from '../reactiveQueries/sql.js'
import * as LiveStoreReact from './index.js'
import { LiveStoreProvider } from './LiveStoreProvider.js'

describe('LiveStoreProvider', () => {
  it('simple', async () => {
    let appRenderCount = 0

    const allTodos$ = querySQL(`select * from todos`, { schema: Schema.Array(tables.todos.schema) })

    const App = () => {
      appRenderCount++

      const todos = LiveStoreReact.useQuery(allTodos$)

      return <div>{JSON.stringify(todos)}</div>
    }

    const abortController = new AbortController()

    const Root = ({ forceUpdate }: { forceUpdate: number }) => {
      const bootCb = React.useCallback(
        (db: BootDb) =>
          db.execute(sql`INSERT OR IGNORE INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);`),
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

    await waitFor(() => screen.getByText('LiveStore Shutdown due to abort signal'))
  })

  it('error during boot', async () => {
    let appRenderCount = 0

    const App = () => {
      appRenderCount++

      return <div>hello world</div>
    }

    const Root = ({ forceUpdate }: { forceUpdate: number }) => {
      const bootCb = React.useCallback(
        (db: BootDb) =>
          db.execute(sql`INSERT INTO todos_mising_table (id, text, completed) VALUES ('t1', 'buy milk', 0);`),
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
