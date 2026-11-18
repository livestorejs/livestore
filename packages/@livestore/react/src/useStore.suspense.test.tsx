import { act, type Queries, type queries, render, type RenderResult, waitFor } from '@testing-library/react'
import * as React from 'react'
import { expect, it, vi } from 'vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import type { Adapter } from '@livestore/common'
import { queryDb, StoreRegistry } from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'

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

it.each([false, true])('keeps sequential cold stores distinct (StrictMode: %s)', async (strictMode) => {
  const registry = new StoreRegistry()
  const adapter = makeInMemoryAdapter()
  const first = { storeId: 'sequential-first', schema, adapter, disableDevtools: true }
  const second = { ...first, storeId: 'sequential-second' }
  const initial = { ...first, storeId: 'sequential-initial' }
  await registry.getOrLoadPromise(initial)
  const recovered: unknown[] = []
  const Consumer = ({ cold }: { cold: boolean }) => {
    const a = useStore(cold === true ? first : initial)
    const b = useStore(cold === true ? second : initial)
    if (cold === true) expect(a).not.toBe(b)
    return <span data-testid="stores">{`${a.storeId}/${b.storeId}`}</span>
  }
  const tree = (cold: boolean) => (
    <StoreRegistryProvider storeRegistry={registry}>
      <React.Suspense fallback="loading">
        <Consumer cold={cold} />
      </React.Suspense>
    </StoreRegistryProvider>
  )
  const view = await act(async () =>
    render<typeof queries>(tree(false), {
      reactStrictMode: strictMode,
      onRecoverableError: (error) => recovered.push(error),
    }),
  )
  try {
    await act(async () => view.rerender(tree(true)))
    await waitFor(() => expect(view.getByTestId('stores').textContent).toBe('sequential-first/sequential-second'))
    expect(recovered).toEqual([])
  } finally {
    await act(async () => view.unmount())
    await registry.dispose()
  }
})

it('preserves the store thenable through a later unrelated suspension', async () => {
  const registry = new StoreRegistry()
  const options = { storeId: 'before-unrelated', schema, adapter: makeInMemoryAdapter(), disableDevtools: true }
  const initial = { ...options, storeId: 'unrelated-initial' }
  await registry.getOrLoadPromise(initial)
  // Already fulfilled but not yet consumed by React: the first use still suspends,
  // then replays immediately with the store promise occupying thenable slot zero.
  const later = Promise.resolve('unrelated')
  const reachedLater = vi.fn()
  const recovered: unknown[] = []
  const Consumer = ({ cold }: { cold: boolean }) => {
    const store = useStore(cold === true ? options : initial)
    reachedLater()
    const value = cold === true ? React.use(later) : 'initial'
    return <span data-testid="result">{`${store.storeId}/${value}`}</span>
  }
  const tree = (cold: boolean) => (
    <StoreRegistryProvider storeRegistry={registry}>
      <React.Suspense fallback="loading">
        <Consumer cold={cold} />
      </React.Suspense>
    </StoreRegistryProvider>
  )
  const view = await act(async () =>
    render<typeof queries>(tree(false), { onRecoverableError: (error) => recovered.push(error) }),
  )
  try {
    reachedLater.mockClear()
    await act(async () => view.rerender(tree(true)))
    await waitFor(() => expect(reachedLater).toHaveBeenCalled())
    await waitFor(() => expect(view.getByTestId('result').textContent).toBe('before-unrelated/unrelated'))
    expect(recovered).toEqual([])
  } finally {
    await act(async () => view.unmount())
    await registry.dispose()
  }
})

it.each(['store', 'registry'] as const)(
  'switches %s identity while a mounted consumer is pending',
  async (switchKind) => {
    const registry = new StoreRegistry()
    const otherRegistry = new StoreRegistry()
    const gate = Promise.withResolvers<void>()
    const started = vi.fn()
    const baseAdapter = makeInMemoryAdapter()
    const delayedAdapter: Adapter = (args) =>
      Effect.andThen(
        Effect.promise(() => {
          started()
          return gate.promise
        }),
        baseAdapter(args),
      )
    const initial = { storeId: 'initial', schema, adapter: baseAdapter, disableDevtools: true }
    const pending = { ...initial, storeId: 'pending', adapter: delayedAdapter }
    const replacement = { ...initial, storeId: switchKind === 'store' ? 'replacement' : 'pending' }
    const observed = vi.fn()
    const Consumer = ({ options }: { options: typeof initial }) => {
      const store = useStore(options)
      observed(store)
      return <span data-testid="identity">{store.storeId}</span>
    }
    const tree = (owner: StoreRegistry, options: typeof initial) => (
      <StoreRegistryProvider storeRegistry={owner}>
        <React.Suspense fallback="loading">
          <Consumer options={options} />
        </React.Suspense>
      </StoreRegistryProvider>
    )
    const view = await act(async () => render(tree(registry, initial)))
    try {
      await waitFor(() => expect(view.getByTestId('identity').textContent).toBe('initial'))
      await act(async () => view.rerender(tree(registry, pending)))
      await waitFor(() => expect(started).toHaveBeenCalled())
      const owner = switchKind === 'registry' ? otherRegistry : registry
      await act(async () => view.rerender(tree(owner, replacement)))
      await waitFor(() => expect(view.getByTestId('identity').textContent).toBe(replacement.storeId))
      await act(async () => gate.resolve())
      expect(view.getByTestId('identity').textContent).toBe(replacement.storeId)
      expect(owner.getOrLoadPromise(replacement)).not.toBeInstanceOf(Promise)
      expect(observed).toHaveBeenLastCalledWith(owner.getOrLoadPromise(replacement))
    } finally {
      gate.resolve()
      await act(async () => view.unmount())
      await registry.dispose()
      await otherRegistry.dispose()
    }
  },
)

it('propagates asynchronous store rejection to the error boundary', async () => {
  const registry = new StoreRegistry()
  const gate = Promise.withResolvers<void>()
  const started = vi.fn()
  const failure = new Error('asynchronous adapter failure')
  const adapter: Adapter = () =>
    Effect.andThen(
      Effect.promise(() => {
        started()
        return gate.promise
      }),
      Effect.die(failure),
    )
  const options = { storeId: 'async-rejection', schema, adapter, disableDevtools: true }
  const caught: unknown[] = []
  class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
    override state = { failed: false }
    static getDerivedStateFromError() {
      return { failed: true }
    }
    override componentDidCatch(error: unknown) {
      caught.push(error)
    }
    override render() {
      return this.state.failed === true ? <span data-testid="failure">failed</span> : this.props.children
    }
  }
  const Consumer = () => {
    useStore(options)
    return <span>unexpected success</span>
  }
  const view = await act(async () =>
    render(
      <StoreRegistryProvider storeRegistry={registry}>
        <Boundary>
          <React.Suspense fallback="loading">
            <Consumer />
          </React.Suspense>
        </Boundary>
      </StoreRegistryProvider>,
    ),
  )
  try {
    await waitFor(() => expect(started).toHaveBeenCalled())
    await act(async () => gate.resolve())
    await waitFor(() => expect(view.getByTestId('failure').textContent).toBe('failed'))
    expect(caught).toHaveLength(1)
    expect(caught[0]).toMatchObject({ cause: failure })
  } finally {
    gate.resolve()
    await act(async () => view.unmount())
    await registry.dispose()
  }
})
