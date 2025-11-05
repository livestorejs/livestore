import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { type RenderResult, render, renderHook, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../../__tests__/fixture.tsx'
import { StoreRegistry } from './StoreRegistry.ts'
import { StoreRegistryProvider } from './StoreRegistryContext.tsx'
import { storeOptions } from './storeOptions.ts'
import type { CachedStoreOptions } from './types.ts'
import { useStore } from './useStore.ts'

describe('experimental useStore', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('suspends when the store is loading', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    const view = render(
      <StoreRegistryProvider storeRegistry={registry}>
        <React.Suspense fallback={<div data-testid="fallback" />}>
          <StoreConsumer options={options} />
        </React.Suspense>
      </StoreRegistryProvider>,
    )

    // Should show fallback while loading
    expect(view.getByTestId('fallback')).toBeDefined()

    // Wait for store to load and component to render
    await waitForSuspenseResolved(view)
    expect(view.getByTestId('ready')).toBeDefined()

    cleanupWithPendingTimers(() => view.unmount())
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

    const view = render(<Wrapper opts={options} />)

    // Wait for initial load
    await waitForSuspenseResolved(view)
    expect(view.getByTestId('ready')).toBeDefined()

    // Rerender with new options object (but same storeId)
    view.rerender(<Wrapper opts={{ ...options }} />)

    // Should not show fallback
    expect(view.queryByTestId('fallback')).toBeNull()
    expect(view.getByTestId('ready')).toBeDefined()

    cleanupWithPendingTimers(() => view.unmount())
  })

  it('throws when store loading fails', async () => {
    const registry = new StoreRegistry()
    const badOptions = testStoreOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    // Pre-load the store to cache the error
    await expect(registry.getOrLoad(badOptions)).rejects.toThrow()

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

    const { result, unmount } = renderHook(() => useStore(options), {
      wrapper: makeProvider(registry, { suspense: true }),
      reactStrictMode: strictMode,
    })

    // Wait for store to be ready
    await waitForStoreReady(result)
    expect(result.current.clientSession).toBeDefined()

    cleanupWithPendingTimers(unmount)
  })

  it('handles switching between different storeId values', async () => {
    const registry = new StoreRegistry()

    const optionsA = testStoreOptions({ storeId: 'store-a' })
    const optionsB = testStoreOptions({ storeId: 'store-b' })

    const { result, rerender, unmount } = renderHook((opts) => useStore(opts), {
      initialProps: optionsA,
      wrapper: makeProvider(registry, { suspense: true }),
    })

    // Wait for first store to load
    await waitForStoreReady(result)
    const storeA = result.current
    expect(storeA.clientSession).toBeDefined()

    // Switch to different storeId
    rerender(optionsB)

    // Wait for second store to load and verify it's different from the first
    await waitFor(() => {
      expect(result.current).not.toBe(storeA)
      expect(result.current?.clientSession).toBeDefined()
    })

    const storeB = result.current
    expect(storeB.clientSession).toBeDefined()
    expect(storeB).not.toBe(storeA)

    cleanupWithPendingTimers(unmount)
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

const testStoreOptions = (overrides: Partial<CachedStoreOptions<typeof schema>> = {}) =>
  storeOptions({
    storeId: 'test-store',
    schema,
    adapter: makeInMemoryAdapter(),
    ...overrides,
  })

/**
 * Cleans up after component unmount by synchronously executing any pending GC timers.
 *
 * When components using stores unmount, the StoreRegistry schedules garbage collection
 * timers for inactive stores. Without this cleanup, those timers may fire during
 * subsequent tests, causing cross-test pollution and flaky failures.
 *
 * This helper switches to fake timers, executes only the already-pending timers
 * (allowing stores to shut down cleanly), then restores real timers for the next test.
 */
const cleanupWithPendingTimers = (cleanup: () => void): void => {
  vi.useFakeTimers()
  cleanup()
  vi.runOnlyPendingTimers()
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
const waitForStoreReady = async <T extends { clientSession?: unknown }>(result: { current: T }): Promise<void> => {
  await waitFor(() => {
    expect(result.current).not.toBeNull()
    expect(result.current?.clientSession).toBeDefined()
  })
}
