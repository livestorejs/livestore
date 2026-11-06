import { act, type Queries, render, type RenderResult, waitFor } from '@testing-library/react'
import * as React from 'react'
import { expect, it, vi } from 'vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { queryDb, StoreRegistry } from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'

import { schema, tables } from './__tests__/fixture.tsx'
import { StoreRegistryProvider } from './StoreRegistryContext.tsx'
import { useStore } from './useStore.ts'

const todos$ = queryDb(tables.todos)

it('replays suspended siblings without recovering the root or booting another store', async () => {
  const registry = new StoreRegistry()
  const adapter = vi.fn(makeInMemoryAdapter())
  const options = { storeId: 'suspended-siblings', schema, adapter, disableDevtools: true }
  const recovered: unknown[] = []
  const Consumer = () => {
    const store = useStore(options)
    const rows = store.useQuery(todos$)
    return <span data-count={rows.length}>ready</span>
  }

  let view: RenderResult<Queries> | undefined
  try {
    await act(async () => {
      view = render(
        <React.StrictMode>
          <StoreRegistryProvider storeRegistry={registry}>
            <React.Suspense fallback="loading">
              <Consumer />
              <Consumer />
              <Consumer />
            </React.Suspense>
          </StoreRegistryProvider>
        </React.StrictMode>,
        { onRecoverableError: (error) => recovered.push(error) },
      )
    })
    const rendered = view ?? shouldNeverHappen('render failed')
    await waitFor(() => expect(rendered.container.querySelectorAll('span[data-count="0"]')).toHaveLength(3))
    expect(recovered).toEqual([])
    expect(adapter).toHaveBeenCalledTimes(1)
  } finally {
    const rendered = view
    if (rendered !== undefined) await act(async () => rendered.unmount())
    await registry.dispose()
  }
})
