import { makeInMemoryAdapter } from '@livestore/adapter-web'
import {
  type RegistryStoreOptions,
  type Store,
  StoreInternalsSymbol,
  StoreRegistry,
  storeOptions,
} from '@livestore/livestore'
import * as SolidTesting from '@solidjs/testing-library'
import { createSignal, type JSX } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { schema } from './__tests__/fixture.tsx'
import { StoreRegistryProvider } from './StoreRegistryContext.tsx'
import { useStore } from './useStore.ts'

describe('useStore', () => {
  it('should return the same promise instance for concurrent getOrLoadStore calls', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    // Make two concurrent calls during loading
    const firstStore = storeRegistry.getOrLoadPromise(options)
    const secondStore = storeRegistry.getOrLoadPromise(options)

    // Both should be promises (store is loading)
    expect(firstStore).toBeInstanceOf(Promise)
    expect(secondStore).toBeInstanceOf(Promise)

    // EXPECTED BEHAVIOR: Same promise instance for Suspense compatibility
    // ACTUAL BEHAVIOR: Different promise instances (Effect.runPromise creates new wrapper)
    expect(firstStore).toBe(secondStore)

    // Cleanup
    await firstStore
    await cleanupAfterUnmount(() => {})
  })

  // NOTE: Tests using SolidTesting.render() are skipped due to pre-existing SSR detection issue
  // in the Solid testing environment. See useQuery.test.tsx for similar skip pattern.
  // Error: "Client-only API called on the server side"
  it.skip('works with Suspense boundary', async () => {
    // This test requires SolidTesting.render() which has SSR detection issues
  })

  it.skip('does not re-suspend on subsequent renders when store is already loaded', async () => {
    // This test requires SolidTesting.render() which has SSR detection issues
  })

  it('throws when store loading fails', async () => {
    const storeRegistry = new StoreRegistry()
    const badOptions = testStoreOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    // Pre-load the store to cache the error (error happens synchronously)
    expect(() => storeRegistry.getOrLoadPromise(badOptions)).toThrow()
  })

  it('basic useStore hook works', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const { result } = SolidTesting.renderHook(() => useStore(options), {
      wrapper: makeProvider(storeRegistry),
    })

    // Wait for store to be ready
    await waitForStoreReady(result)
    expect(result()![StoreInternalsSymbol].clientSession).toBeDefined()

    await cleanupAfterUnmount(() => {})
  })

  it('handles switching between different storeId values', async () => {
    const storeRegistry = new StoreRegistry()

    const optionsA = testStoreOptions({ storeId: 'store-a' })
    const optionsB = testStoreOptions({ storeId: 'store-b' })

    // Use a signal to trigger reactive updates (Solid's pattern instead of rerender)
    const [currentOptions, setCurrentOptions] = createSignal<RegistryStoreOptions<typeof schema>>(optionsA)

    const { result } = SolidTesting.renderHook(() => useStore(currentOptions), {
      wrapper: makeProvider(storeRegistry),
    })

    // Wait for first store to load
    await waitForStoreReady(result)
    const storeA = result()
    expect(storeA![StoreInternalsSymbol].clientSession).toBeDefined()

    // Switch to different storeId - Solid's reactivity will automatically update
    setCurrentOptions(optionsB)

    // Wait for second store to load and verify it's different from the first
    await SolidTesting.waitFor(() => {
      const current = result()
      expect(current).not.toBe(storeA)
      expect(current?.[StoreInternalsSymbol].clientSession).toBeDefined()
    })

    const storeB = result()
    expect(storeB![StoreInternalsSymbol].clientSession).toBeDefined()
    expect(storeB).not.toBe(storeA)

    await cleanupAfterUnmount(() => {})
  })

  // useStore doesn't handle unusedCacheTime=0 correctly because retain is called in createMemo (after resource fetch)
  // See https://github.com/livestorejs/livestore/issues/916
  it.skip('should load store with unusedCacheTime set to 0', async () => {
    // Skipped: retain timing issue with unusedCacheTime=0
  })
})

const makeProvider = (storeRegistry: StoreRegistry) => (props: { children: JSX.Element }) => {
  return <StoreRegistryProvider storeRegistry={storeRegistry}>{props.children}</StoreRegistryProvider>
}

let testStoreCounter = 0

const testStoreOptions = (overrides: Partial<RegistryStoreOptions<typeof schema>> = {}) =>
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
 * Waits for a store resource to be fully loaded and ready to use.
 * The store is considered ready when it has a defined clientSession.
 */
const waitForStoreReady = async (result: () => Store<any> | undefined): Promise<void> => {
  await SolidTesting.waitFor(() => {
    const store = result()
    expect(store).not.toBeNull()
    expect(store).not.toBeUndefined()
    expect(store![StoreInternalsSymbol].clientSession).toBeDefined()
  })
}
