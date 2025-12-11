import { makeInMemoryAdapter } from '@livestore/adapter-web'
import {
  type CachedStoreOptions,
  type Store,
  StoreInternalsSymbol,
  StoreRegistry,
  storeOptions,
} from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'
import { act, type RenderHookResult, type RenderResult, render, renderHook, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { schema } from './__tests__/fixture.tsx'
import { StoreRegistryProvider } from './StoreRegistryContext.tsx'
import { useStore } from './useStore.ts'

describe('experimental useStore', () => {
  it('should return the same promise instance for concurrent getOrLoadStore calls', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    // Make two concurrent calls during loading
    const firstStore = registry.getOrLoadPromise(options)
    const secondStore = registry.getOrLoadPromise(options)

    // Both should be promises (store is loading)
    expect(firstStore).toBeInstanceOf(Promise)
    expect(secondStore).toBeInstanceOf(Promise)

    // EXPECTED BEHAVIOR: Same promise instance for React.use() compatibility
    // ACTUAL BEHAVIOR: Different promise instances (Effect.runPromise creates new wrapper)
    expect(firstStore).toBe(secondStore)

    // Cleanup
    await firstStore
    await cleanupAfterUnmount(() => {})
  })

  it('works with Suspense boundary', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    let view: RenderResult | undefined
    await act(async () => {
      view = render(
        <StoreRegistryProvider storeRegistry={registry}>
          <React.Suspense fallback={<div data-testid="fallback" />}>
            <StoreConsumer options={options} />
          </React.Suspense>
        </StoreRegistryProvider>,
      )
    })
    const renderedView = view ?? shouldNeverHappen('render failed')

    // After loading completes, should show the actual content
    await waitForSuspenseResolved(renderedView)
    expect(renderedView.getByTestId('ready')).toBeDefined()

    await cleanupAfterUnmount(() => renderedView.unmount())
  })

  it('does not re-suspend on subsequent renders when store is already loaded', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    const Wrapper = ({ opts }: { opts: CachedStoreOptions<typeof schema> }) => (
      <StoreRegistryProvider storeRegistry={registry}>
        <React.Suspense fallback={<div data-testid="fallback" />}>
          <StoreConsumer options={opts} />
        </React.Suspense>
      </StoreRegistryProvider>
    )

    let view: RenderResult | undefined
    await act(async () => {
      view = render(<Wrapper opts={options} />)
    })
    const renderedView = view ?? shouldNeverHappen('render failed')

    // Wait for initial load
    await waitForSuspenseResolved(renderedView)
    expect(renderedView.getByTestId('ready')).toBeDefined()

    // Rerender with new options object (but same storeId)
    await act(async () => {
      renderedView.rerender(<Wrapper opts={{ ...options }} />)
    })

    // Should not show fallback
    expect(renderedView.queryByTestId('fallback')).toBeNull()
    expect(renderedView.getByTestId('ready')).toBeDefined()

    await cleanupAfterUnmount(() => renderedView.unmount())
  })

  it('throws when store loading fails', async () => {
    const registry = new StoreRegistry()
    const badOptions = testStoreOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    // Pre-load the store to cache the error (error happens synchronously)
    expect(() => registry.getOrLoadPromise(badOptions)).toThrow()

    // Now when useStore tries to get it, it should throw synchronously
    expect(() =>
      renderHook(() => useStore(badOptions), {
        wrapper: makeProvider(registry),
      }),
    ).toThrow()
  })

  it.each([
    { label: 'non-strict mode', strictMode: false },
    { label: 'strict mode', strictMode: true },
  ])('works in $label', async ({ strictMode }) => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    let hook: RenderHookResult<Store<typeof schema>, CachedStoreOptions<typeof schema>> | undefined
    await act(async () => {
      hook = renderHook(() => useStore(options), {
        wrapper: makeProvider(registry, { suspense: true }),
        reactStrictMode: strictMode,
      })
    })
    const { result, unmount } = hook ?? shouldNeverHappen('renderHook failed')

    // Wait for store to be ready
    await waitForStoreReady(result)
    expect(result.current[StoreInternalsSymbol].clientSession).toBeDefined()

    await cleanupAfterUnmount(unmount)
  })

  it('handles switching between different storeId values', async () => {
    const registry = new StoreRegistry()

    const optionsA = testStoreOptions({ storeId: 'store-a' })
    const optionsB = testStoreOptions({ storeId: 'store-b' })

    let hook: RenderHookResult<Store<typeof schema>, CachedStoreOptions<typeof schema>> | undefined
    await act(async () => {
      hook = renderHook((opts) => useStore(opts), {
        initialProps: optionsA,
        wrapper: makeProvider(registry, { suspense: true }),
      })
    })
    const { result, rerender, unmount } = hook ?? shouldNeverHappen('renderHook failed')

    // Wait for first store to load
    await waitForStoreReady(result)
    const storeA = result.current
    expect(storeA[StoreInternalsSymbol].clientSession).toBeDefined()

    // Switch to different storeId
    await act(async () => {
      rerender(optionsB)
    })

    // Wait for second store to load and verify it's different from the first
    await waitFor(() => {
      expect(result.current).not.toBe(storeA)
      expect(result.current?.[StoreInternalsSymbol].clientSession).toBeDefined()
    })

    const storeB = result.current
    expect(storeB[StoreInternalsSymbol].clientSession).toBeDefined()
    expect(storeB).not.toBe(storeA)

    await cleanupAfterUnmount(unmount)
  })

  // useStore doesn't handle unusedCacheTime=0 correctly because retain is called in useEffect (after render)
  // See https://github.com/livestorejs/livestore/issues/916
  it.skip('should load store with unusedCacheTime set to 0', async () => {
    const registry = new StoreRegistry({ defaultOptions: { unusedCacheTime: 0 } })
    const options = testStoreOptions({ unusedCacheTime: 0 })

    const StoreConsumerWithVerification = ({ opts }: { opts: CachedStoreOptions<typeof schema> }) => {
      const store = useStore(opts)
      // Verify store is usable - access internals to confirm it's not disposed
      const clientSession = store[StoreInternalsSymbol].clientSession
      return <div data-testid="ready" data-has-session={String(clientSession !== undefined)} />
    }

    let view: RenderResult | undefined
    await act(async () => {
      view = render(
        <StoreRegistryProvider storeRegistry={registry}>
          <React.Suspense fallback={<div data-testid="fallback" />}>
            <StoreConsumerWithVerification opts={options} />
          </React.Suspense>
        </StoreRegistryProvider>,
      )
    })
    const renderedView = view ?? shouldNeverHappen('render failed')

    await waitForSuspenseResolved(renderedView)

    // Store should be usable while component is mounted
    const readyElement = renderedView.getByTestId('ready')
    expect(readyElement.getAttribute('data-has-session')).toBe('true')

    // Allow some time to pass to ensure store isn't prematurely disposed
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Store should still be usable after waiting
    expect(readyElement.getAttribute('data-has-session')).toBe('true')

    await cleanupAfterUnmount(() => renderedView.unmount())
  })
})

const StoreConsumer = ({ options }: { options: CachedStoreOptions<any> }) => {
  useStore(options)
  return <div data-testid="ready" />
}

const makeProvider =
  (registry: StoreRegistry, { suspense = false }: { suspense?: boolean } = {}) =>
  ({ children }: { children: React.ReactNode }) => {
    let content = <StoreRegistryProvider storeRegistry={registry}>{children}</StoreRegistryProvider>

    if (suspense) {
      content = <React.Suspense fallback={null}>{content}</React.Suspense>
    }

    return content
  }

let testStoreCounter = 0

const testStoreOptions = (overrides: Partial<CachedStoreOptions<typeof schema>> = {}) =>
  storeOptions({
    storeId: overrides.storeId ?? `test-store-${testStoreCounter++}`,
    schema,
    adapter: makeInMemoryAdapter(),
    ...overrides,
  })

/**
 * Cleans up after component unmount and waits for pending operations to settle.
 *
 * When components using stores unmount, the StoreRegistry schedules garbage collection
 * timers for inactive stores. This helper waits for those timers to complete naturally.
 */
const cleanupAfterUnmount = async (cleanup: () => void): Promise<void> => {
  cleanup()
  // Allow any pending microtasks/timers to settle
  await new Promise((resolve) => setTimeout(resolve, 100))
}

/**
 * Waits for React Suspense fallback to resolve and the actual content to render.
 */
const waitForSuspenseResolved = async (view: RenderResult): Promise<void> => {
  await waitFor(() => expect(view.queryByTestId('fallback')).toBeNull())
}

/**
 * Waits for a store to be fully loaded and ready to use.
 * The store is considered ready when it has a defined clientSession.
 */
const waitForStoreReady = async (result: { current: Store<any> }): Promise<void> => {
  await waitFor(() => {
    expect(result.current).not.toBeNull()
    expect(result.current[StoreInternalsSymbol].clientSession).toBeDefined()
  })
}
