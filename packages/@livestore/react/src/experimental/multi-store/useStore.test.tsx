import { createStorePromise, type Store } from '@livestore/livestore'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withReactApi } from '../../useStore.ts'
import { StoreRegistry } from './StoreRegistry.ts'
import { StoreRegistryProvider } from './StoreRegistryContext.tsx'
import type { CachedStoreOptions } from './types.ts'
import { useStore } from './useStore.ts'

vi.mock('../../useStore.ts', () => ({
  withReactApi: vi.fn((store: Record<string, unknown>) => ({ ...store, decorated: true })),
}))

vi.mock('@livestore/livestore', () => ({
  createStorePromise: vi.fn(),
}))

const mockedWithReactApi = vi.mocked(withReactApi)
const mockedCreateStorePromise = vi.mocked(createStorePromise)

describe('experimental useStore', () => {
  beforeEach(() => {
    mockedWithReactApi.mockClear()
    mockedCreateStorePromise.mockReset()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('suspends when the store is loading', async () => {
    const store = createTestStore()
    const deferred = createDeferred<typeof store>()
    const registry = new StoreRegistry()
    mockedCreateStorePromise.mockReturnValueOnce(deferred.promise as Promise<Store<any>>)
    const options = makeOptions()

    const view = render(
      <StoreRegistryProvider storeRegistry={registry}>
        <React.Suspense fallback={<div data-testid="fallback" />}>
          <StoreConsumer options={options} />
        </React.Suspense>
      </StoreRegistryProvider>,
    )

    expect(view.getByTestId('fallback')).toBeDefined()
    expect(mockedWithReactApi).not.toHaveBeenCalled()

    await act(async () => {
      deferred.resolve(store)
      await Promise.resolve()
    })

    await waitFor(() => expect(mockedWithReactApi).toHaveBeenCalledWith(store))
    expect(view.queryByTestId('fallback')).toBeNull()
  })

  it('does not re-suspend on subsequent renders when store is already loaded', async () => {
    const store = createTestStore()
    const deferred = createDeferred<typeof store>()
    const registry = new StoreRegistry()
    mockedCreateStorePromise.mockReturnValueOnce(deferred.promise as Promise<Store<any>>)
    const options = makeOptions()

    const Wrapper = ({ opts }: { opts: CachedStoreOptions }) => (
      <StoreRegistryProvider storeRegistry={registry}>
        <React.Suspense fallback={<div data-testid="fallback" />}>
          <StoreConsumer options={opts} />
        </React.Suspense>
      </StoreRegistryProvider>
    )

    const view = render(<Wrapper opts={options} />)
    expect(view.getByTestId('fallback')).toBeDefined()

    await act(async () => {
      deferred.resolve(store)
      await Promise.resolve()
    })

    await waitFor(() => expect(mockedWithReactApi).toHaveBeenCalledWith(store))
    expect(view.queryByTestId('fallback')).toBeNull()
    const callsAfterLoad = mockedWithReactApi.mock.calls.length

    view.rerender(<Wrapper opts={{ ...options }} />)
    expect(view.queryByTestId('fallback')).toBeNull()
    expect(mockedWithReactApi.mock.calls.length).toBeGreaterThanOrEqual(callsAfterLoad)
  })

  it('subscribes to store registry on mount', () => {
    const store = createTestStore()
    const registry = createMockRegistry({
      getOrLoad: vi.fn().mockReturnValue(store),
    })
    const options = makeOptions()

    renderHook(() => useStore(options), {
      wrapper: makeProvider(registry),
    })

    expect(registry.subscribe).toHaveBeenCalledWith(options.storeId, expect.any(Function))
  })

  it('unsubscribes from store registry on unmount', () => {
    const store = createTestStore()
    const registry = createMockRegistry({
      getOrLoad: vi.fn().mockReturnValue(store),
    })
    const options = makeOptions()

    const { unmount } = renderHook(() => useStore(options), {
      wrapper: makeProvider(registry),
    })

    unmount()
    expect(registry.unsubscribeSpy).toHaveBeenCalledTimes(1)
  })

  it('handles rapid mount/unmount cycles', () => {
    const store = createTestStore()
    const registry = createMockRegistry({
      getOrLoad: vi.fn().mockReturnValue(store),
    })
    const options = makeOptions()

    const first = renderHook(() => useStore(options), {
      wrapper: makeProvider(registry),
    })
    first.unmount()

    const second = renderHook(() => useStore(options), {
      wrapper: makeProvider(registry),
    })
    second.unmount()

    expect(registry.subscribe).toHaveBeenCalledTimes(2)
    expect(registry.unsubscribeSpy).toHaveBeenCalledTimes(2)
  })

  it('throws when store loading fails', () => {
    const error = new Error('failed to load')
    const registry = createMockRegistry({
      getOrLoad: vi.fn(() => {
        throw error
      }),
    })
    const options = makeOptions()

    expect(() =>
      renderHook(() => useStore(options), {
        wrapper: makeProvider(registry),
      }),
    ).toThrow(error)
  })

  it.each([
    { label: 'non-strict mode', strict: false },
    { label: 'strict mode', strict: true },
  ])('works with both $label', async ({ strict }) => {
    const store = createTestStore()
    const registry = createMockRegistry({
      getOrLoad: vi.fn().mockReturnValue(store),
    })
    const options = makeOptions()

    const { result, unmount } = renderHook(() => useStore(options), {
      wrapper: makeProvider(registry, { strict }),
    })

    await waitFor(() => expect(result.current).toMatchObject({ decorated: true }))
    expect(registry.subscribe).toHaveBeenCalled()
    unmount()
    expect(registry.unsubscribeSpy).toHaveBeenCalled()
  })

  it('handles switching between different storeId values', () => {
    const storeA = { id: 'a', shutdownPromise: vi.fn() } as unknown as Store<any>
    const storeB = { id: 'b', shutdownPromise: vi.fn() } as unknown as Store<any>
    const getOrLoadMock = vi.fn(
      (opts: CachedStoreOptions) => (opts.storeId === 'a' ? storeA : storeB) as Store<any> | Promise<Store<any>>,
    )
    const registry = createMockRegistry({ getOrLoad: getOrLoadMock as StoreRegistry['getOrLoad'] })

    const { rerender } = renderHook((opts) => useStore(opts), {
      initialProps: makeOptions({ storeId: 'a' }),
      wrapper: makeProvider(registry),
    })

    expect(registry.subscribe).toHaveBeenCalledWith('a', expect.any(Function))
    expect(mockedWithReactApi).toHaveBeenLastCalledWith(storeA)

    rerender(makeOptions({ storeId: 'b' }))
    expect(registry.unsubscribeSpy).toHaveBeenCalledTimes(1)
    expect(registry.subscribe).toHaveBeenLastCalledWith('b', expect.any(Function))
    expect(mockedWithReactApi).toHaveBeenLastCalledWith(storeB)
  })
})

type RegistryMock = StoreRegistry & {
  getOrLoad: ReturnType<typeof vi.fn> & StoreRegistry['getOrLoad']
  subscribe: ReturnType<typeof vi.fn> & StoreRegistry['subscribe']
  unsubscribeSpy: ReturnType<typeof vi.fn>
}

const createMockRegistry = (overrides: Partial<{ getOrLoad: StoreRegistry['getOrLoad'] }> = {}) => {
  const registry = new StoreRegistry() as RegistryMock
  const listeners = new Set<() => void>()
  const unsubscribeSpy = vi.fn()

  const subscribe = vi.fn((_: string, listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      unsubscribeSpy()
    }
  }) as RegistryMock['subscribe']

  const getOrLoad = (overrides.getOrLoad ?? vi.fn()) as RegistryMock['getOrLoad']

  Object.assign(registry, { getOrLoad, subscribe, unsubscribeSpy })

  return registry
}

const StoreConsumer = ({ options }: { options: CachedStoreOptions }) => {
  useStore(options)
  return <div data-testid="ready" />
}

const makeProvider =
  (
    registry: ReturnType<typeof createMockRegistry>,
    { suspense = false, strict = false }: { suspense?: boolean; strict?: boolean } = {},
  ) =>
  ({ children }: { children: React.ReactNode }) => {
    let content = <StoreRegistryProvider storeRegistry={registry as never}>{children}</StoreRegistryProvider>

    if (suspense) {
      content = <React.Suspense fallback={null}>{content}</React.Suspense>
    }

    if (strict) {
      content = <React.StrictMode>{content}</React.StrictMode>
    }

    return content
  }

const makeOptions = (overrides: Partial<CachedStoreOptions> = {}): CachedStoreOptions => ({
  adapter: {} as CachedStoreOptions['adapter'],
  schema: {} as CachedStoreOptions['schema'],
  storeId: 'default-store',
  ...overrides,
})

const createTestStore = () =>
  ({
    shutdownPromise: vi.fn().mockResolvedValue(undefined),
  }) as unknown as Store<any>

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
