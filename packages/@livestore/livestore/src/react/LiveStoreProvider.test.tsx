import type { StorageDatabase } from '@livestore/common'
import { sql } from '@livestore/common'
import { makeDb } from '@livestore/web'
import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { parseTodos, schema } from '../__tests__/react/fixture.js'
import { querySQL } from '../reactiveQueries/sql.js'
import type { BootDb, Store } from '../store.js'
import * as LiveStoreReact from './index.js'
import { LiveStoreProvider } from './LiveStoreProvider.js'

class TestInMemoryStorage implements StorageDatabase {
  filename = '__test__in-memory__'

  constructor() {}

  execute = async () => {}

  mutate = async () => {}

  export = async () => undefined

  getMutationLogData = async (): Promise<Uint8Array> => new Uint8Array()

  dangerouslyReset = async () => {}
  shutdown = async () => {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

describe('LiveStoreProvider', () => {
  it('simple', async () => {
    let renderCount = 0

    const allTodos$ = querySQL(`select * from todos`, { map: parseTodos })
    let latestStoreCtx: { store: Store } | undefined = undefined

    const App = () => {
      renderCount++

      latestStoreCtx = LiveStoreReact.useStore()

      const todos = LiveStoreReact.useQuery(allTodos$)

      return <div>{JSON.stringify(todos)}</div>
    }

    const Root = ({ forceUpdate }: { forceUpdate: number }) => {
      const bootCb = React.useCallback(
        (db: BootDb) =>
          db.execute(sql`INSERT OR IGNORE INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);`),
        [],
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const makeDbMemo = React.useMemo(() => makeDb(() => () => new TestInMemoryStorage()), [forceUpdate])
      return (
        <LiveStoreProvider schema={schema} fallback={<div>Loading LiveStore</div>} makeDb={makeDbMemo} boot={bootCb}>
          <App />
        </LiveStoreProvider>
      )
    }

    const { rerender } = render(<Root forceUpdate={1} />)

    expect(renderCount).toBe(0)

    await waitForElementToBeRemoved(() => screen.getByText('Loading LiveStore'))

    expect(renderCount).toBe(1)

    rerender(<Root forceUpdate={2} />)

    await waitFor(() => screen.getByText('Loading LiveStore'))
    await waitForElementToBeRemoved(() => screen.getByText('Loading LiveStore'))

    expect(renderCount).toBe(2)

    await latestStoreCtx!.store.destroy()
  })
})
