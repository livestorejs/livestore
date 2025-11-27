import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { StoreInternalsSymbol } from '@livestore/livestore'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../../__tests__/fixture.tsx'
import { DEFAULT_UNUSED_CACHE_TIME, StoreRegistry } from './StoreRegistry.ts'
import { storeOptions } from './storeOptions.ts'
import type { CachedStoreOptions } from './types.ts'

describe('StoreRegistry', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('returns a Promise when the store is loading', async () => {
    const registry = new StoreRegistry()
    const result = registry.getOrLoad(testStoreOptions())

    expect(result).toBeInstanceOf(Promise)

    // Clean up
    const store = await result
    await store.shutdownPromise()
  })

  it('returns cached store synchronously after first load resolves', async () => {
    const registry = new StoreRegistry()

    const initial = registry.getOrLoad(testStoreOptions())
    expect(initial).toBeInstanceOf(Promise)

    const store = await initial

    const cached = registry.getOrLoad(testStoreOptions())
    expect(cached).toBe(store)
    expect(cached).not.toBeInstanceOf(Promise)

    // Clean up
    await store.shutdownPromise()
  })

  it('reuses the same promise for concurrent getOrLoad calls while loading', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    const first = registry.getOrLoad(options)
    const second = registry.getOrLoad(options)

    // Both should be the same promise
    expect(first).toBe(second)
    expect(first).toBeInstanceOf(Promise)

    const store = await first

    // Both promises should resolve to the same store
    expect(await second).toBe(store)

    // Clean up
    await store.shutdownPromise()
  })

  it('stores and rethrows the rejection on subsequent getOrLoad calls after a failure', async () => {
    const registry = new StoreRegistry()

    // Create an invalid adapter that will cause an error
    const badOptions = testStoreOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    await expect(registry.getOrLoad(badOptions)).rejects.toThrow()

    // Subsequent call should throw the cached error synchronously
    expect(() => registry.getOrLoad(badOptions)).toThrow()
  })

  it('disposes store after unusedCacheTime expires', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const unusedCacheTime = 25
    const options = testStoreOptions({ unusedCacheTime })

    const store = await registry.getOrLoad(options)

    // Store should be cached
    expect(registry.getOrLoad(options)).toBe(store)

    // Advance time to trigger disposal
    await vi.advanceTimersByTimeAsync(unusedCacheTime)

    // After disposal, store should be removed
    // The store is removed from cache, so next getOrLoad creates a new one
    const nextStore = await registry.getOrLoad(options)

    // Should be a different store instance
    expect(nextStore).not.toBe(store)
    expect(nextStore[StoreInternalsSymbol].clientSession.debugInstanceId).toBeDefined()

    // Clean up the second store (first one was disposed)
    await nextStore.shutdownPromise()
  })

  it('keeps the longest unusedCacheTime seen for a store when options vary across calls', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()

    const options = testStoreOptions({ unusedCacheTime: 10 })
    const unsubscribe = registry.subscribe(options.storeId, () => {})

    const store = await registry.getOrLoad(options)

    // Call with longer unusedCacheTime
    await registry.getOrLoad(testStoreOptions({ unusedCacheTime: 100 }))

    unsubscribe()

    // After 99ms, store should still be alive (100ms unusedCacheTime used)
    await vi.advanceTimersByTimeAsync(99)

    // Store should still be cached
    expect(registry.getOrLoad(options)).toBe(store)

    // After the full 100ms, store should be disposed
    await vi.advanceTimersByTimeAsync(1)

    // Next getOrLoad should create a new store
    const nextStore = await registry.getOrLoad(options)
    expect(nextStore).not.toBe(store)

    // Clean up the second store (first one was disposed)
    await nextStore.shutdownPromise()
  })

  it('preload does not throw', async () => {
    const registry = new StoreRegistry()

    // Create invalid options that would cause an error
    const badOptions = testStoreOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    // preload should not throw
    await expect(registry.preload(badOptions)).resolves.toBeUndefined()

    // But subsequent getOrLoad should throw the cached error
    expect(() => registry.getOrLoad(badOptions)).toThrow()
  })

  it('does not dispose when unusedCacheTime is Infinity', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const options = testStoreOptions({ unusedCacheTime: Number.POSITIVE_INFINITY })

    const store = await registry.getOrLoad(options)

    // Store should be cached
    expect(registry.getOrLoad(options)).toBe(store)

    // Advance time by a very long duration
    await vi.advanceTimersByTimeAsync(1000000)

    // Store should still be cached (not disposed)
    expect(registry.getOrLoad(options)).toBe(store)

    // Clean up manually
    await store.shutdownPromise()
  })

  it('throws the same error instance on multiple synchronous calls after failure', async () => {
    const registry = new StoreRegistry()

    const badOptions = testStoreOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    // Wait for the first failure
    await expect(registry.getOrLoad(badOptions)).rejects.toThrow()

    // Capture the errors from subsequent synchronous calls
    let error1: unknown
    let error2: unknown

    try {
      registry.getOrLoad(badOptions)
    } catch (err) {
      error1 = err
    }

    try {
      registry.getOrLoad(badOptions)
    } catch (err) {
      error2 = err
    }

    // Both should be the exact same error instance (cached)
    expect(error1).toBeDefined()
    expect(error1).toBe(error2)
  })

  it('notifies subscribers when store state changes', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    let notificationCount = 0
    const listener = () => {
      notificationCount++
    }

    const unsubscribe = registry.subscribe(options.storeId, listener)

    // Start loading the store
    const storePromise = registry.getOrLoad(options)

    // Listener should be called when store starts loading
    expect(notificationCount).toBe(1)

    const store = await storePromise

    // Listener should be called when store loads successfully
    expect(notificationCount).toBe(2)

    unsubscribe()

    // Clean up
    await store.shutdownPromise()
  })

  it('handles rapid subscribe/unsubscribe cycles without errors', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const unusedCacheTime = 50
    const options = testStoreOptions({ unusedCacheTime })

    const store = await registry.getOrLoad(options)

    // Rapidly subscribe and unsubscribe multiple times
    for (let i = 0; i < 10; i++) {
      const unsubscribe = registry.subscribe(options.storeId, () => {})
      unsubscribe()
    }

    // Advance time to check if disposal is scheduled correctly
    await vi.advanceTimersByTimeAsync(unusedCacheTime)

    // Store should be disposed after the last unsubscribe
    const nextStore = await registry.getOrLoad(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })

  it('swallows errors thrown by subscribers during notification', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    let errorListenerCalled = false
    let goodListenerCalled = false

    const errorListener = () => {
      errorListenerCalled = true
      throw new Error('Listener error')
    }

    const goodListener = () => {
      goodListenerCalled = true
    }

    registry.subscribe(options.storeId, errorListener)
    registry.subscribe(options.storeId, goodListener)

    // Should not throw despite errorListener throwing
    const store = await registry.getOrLoad(options)

    // Both listeners should have been called
    expect(errorListenerCalled).toBe(true)
    expect(goodListenerCalled).toBe(true)

    await store.shutdownPromise()
  })

  it('supports concurrent load and subscribe operations', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    let notificationCount = 0
    const listener = () => {
      notificationCount++
    }

    // Subscribe before loading starts
    const unsubscribe = registry.subscribe(options.storeId, listener)

    // Start loading
    const storePromise = registry.getOrLoad(options)

    // Listener should be notified when loading starts
    expect(notificationCount).toBeGreaterThan(0)

    const store = await storePromise

    // Listener should be notified when loading completes
    expect(notificationCount).toBe(2)

    unsubscribe()

    // Clean up
    await store.shutdownPromise()
  })

  it('cancels disposal when a new subscription is added', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const unusedCacheTime = 50
    const options = testStoreOptions({ unusedCacheTime })

    const store = await registry.getOrLoad(options)

    // Advance time almost to disposal threshold
    await vi.advanceTimersByTimeAsync(unusedCacheTime - 5)

    // Add a new subscription before disposal triggers
    const unsubscribe = registry.subscribe(options.storeId, () => {})

    // Complete the original unusedCacheTime
    await vi.advanceTimersByTimeAsync(5)

    // Store should not have been disposed because we added a subscription
    expect(registry.getOrLoad(options)).toBe(store)

    // Clean up
    unsubscribe()
    await vi.advanceTimersByTimeAsync(unusedCacheTime)

    // Now it should be disposed
    const nextStore = await registry.getOrLoad(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })

  it('schedules disposal if store becomes unused during loading', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const unusedCacheTime = 50
    const options = testStoreOptions({ unusedCacheTime })

    // Start loading without any subscription
    const storePromise = registry.getOrLoad(options)

    // Wait for store to load (no subscribers registered)
    const store = await storePromise

    // Since there were no subscribers when loading completed, disposal should be scheduled
    await vi.advanceTimersByTimeAsync(unusedCacheTime)

    // Store should be disposed
    const nextStore = await registry.getOrLoad(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })

  it('aborts loading when disposal fires while store is still loading', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const unusedCacheTime = 10
    const options = testStoreOptions({ unusedCacheTime })

    // Subscribe briefly to trigger getOrLoad and then unsubscribe
    const unsubscribe = registry.subscribe(options.storeId, () => {})

    // Start loading - this will be slow due to fake timers
    const loadPromise = registry.getOrLoad(options)

    // Attach a catch handler to prevent unhandled rejection when the load is aborted
    const abortedPromise = (loadPromise as Promise<unknown>).catch(() => {
      // Expected: load was aborted by disposal
    })

    // Unsubscribe immediately, which schedules disposal
    unsubscribe()

    // Advance time to trigger disposal while still loading
    await vi.advanceTimersByTimeAsync(unusedCacheTime)

    // Wait for the abort to complete
    await abortedPromise

    // After abort, a new getOrLoad should start a fresh load
    const freshLoadPromise = registry.getOrLoad(options)

    // This should be a new promise (not the aborted one)
    expect(freshLoadPromise).toBeInstanceOf(Promise)
    expect(freshLoadPromise).not.toBe(loadPromise)

    // Wait for fresh load to complete
    const store = await freshLoadPromise
    expect(store).toBeDefined()

    await store.shutdownPromise()
  })

  it('does not abort loading when new subscription arrives before disposal fires', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const unusedCacheTime = 50
    const options = testStoreOptions({ unusedCacheTime })

    // Start loading and immediately unsubscribe to schedule disposal
    const unsub1 = registry.subscribe(options.storeId, () => {})
    const loadPromise = registry.getOrLoad(options)
    unsub1()

    // Advance time partially (before disposal fires)
    await vi.advanceTimersByTimeAsync(unusedCacheTime - 10)

    // Add a new subscription - this should cancel the pending disposal
    const unsub2 = registry.subscribe(options.storeId, () => {})

    // Advance past the original unusedCacheTime
    await vi.advanceTimersByTimeAsync(20)

    // The load should complete normally (not be aborted)
    const store = await loadPromise

    // And should be the same instance when retrieved again
    const cachedStore = registry.getOrLoad(options)
    expect(cachedStore).toBe(store)

    unsub2()
    await store.shutdownPromise()
  })

  it('manages multiple stores with different IDs independently', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()

    const options1 = testStoreOptions({ storeId: 'store-1', unusedCacheTime: 50 })
    const options2 = testStoreOptions({ storeId: 'store-2', unusedCacheTime: 100 })

    const store1 = await registry.getOrLoad(options1)
    const store2 = await registry.getOrLoad(options2)

    // Should be different store instances
    expect(store1).not.toBe(store2)

    // Both should be cached independently
    expect(registry.getOrLoad(options1)).toBe(store1)
    expect(registry.getOrLoad(options2)).toBe(store2)

    // Advance time to dispose store1 only
    await vi.advanceTimersByTimeAsync(50)

    // store1 should be disposed, store2 should still be cached
    const newStore1 = await registry.getOrLoad(options1)
    expect(newStore1).not.toBe(store1)
    expect(registry.getOrLoad(options2)).toBe(store2)

    // Subscribe to prevent disposal of newStore1
    const unsub1 = registry.subscribe(options1.storeId, () => {})

    // Advance remaining time to dispose store2
    await vi.advanceTimersByTimeAsync(50)

    // store2 should be disposed
    const newStore2 = await registry.getOrLoad(options2)
    expect(newStore2).not.toBe(store2)

    // Subscribe to prevent disposal of newStore2
    const unsub2 = registry.subscribe(options2.storeId, () => {})

    // Clean up
    unsub1()
    unsub2()
    await newStore1.shutdownPromise()
    await newStore2.shutdownPromise()
  })

  it('applies default options from constructor', async () => {
    vi.useFakeTimers()

    const registry = new StoreRegistry({
      defaultOptions: {
        unusedCacheTime: DEFAULT_UNUSED_CACHE_TIME * 2,
      },
    })

    const options = testStoreOptions()

    const store = await registry.getOrLoad(options)

    // Verify the store loads successfully
    expect(store).toBeDefined()
    expect(store[StoreInternalsSymbol].clientSession.debugInstanceId).toBeDefined()

    // Verify configured default unusedCacheTime is applied by checking disposal doesn't happen at library's default time
    await vi.advanceTimersByTimeAsync(DEFAULT_UNUSED_CACHE_TIME)

    // Store should still be cached after default unusedCacheTime
    expect(registry.getOrLoad(options)).toBe(store)

    await store.shutdownPromise()
  })

  it('allows call-site options to override default options', async () => {
    vi.useFakeTimers()

    const registry = new StoreRegistry({
      defaultOptions: {
        unusedCacheTime: 1000, // Default is long
      },
    })

    const options = testStoreOptions({
      unusedCacheTime: 10, // Override with shorter time
    })

    const store = await registry.getOrLoad(options)

    // Advance by the override time (10ms)
    await vi.advanceTimersByTimeAsync(10)

    // Should be disposed according to the override time, not default
    const nextStore = await registry.getOrLoad(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })

  it('prevents subscriptions to stores that are shutting down', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const unusedCacheTime = 10
    const options = testStoreOptions({ unusedCacheTime })

    // Load the store and wait for it to be ready
    const originalStore = await registry.getOrLoad(options)

    // Verify store is cached
    expect(registry.getOrLoad(options)).toBe(originalStore)

    // Spy on shutdownPromise to detect when shutdown starts
    let shutdownStarted = false
    let shutdownCompleted = false
    const originalShutdownPromise = originalStore.shutdownPromise.bind(originalStore)
    originalStore.shutdownPromise = () => {
      shutdownStarted = true
      return originalShutdownPromise().finally(() => {
        shutdownCompleted = true
      })
    }

    // Use vi.advanceTimersToNextTimer to advance ONLY to the disposal timer firing,
    // then immediately (before microtasks resolve) try to get the store
    vi.advanceTimersToNextTimer()

    // The disposal callback has now executed synchronously, which means:
    // 1. Subscriber check passed (no subscribers)
    // 2. shutdown() was called (but it's async, hasn't resolved yet)
    // 3. Cache entry SHOULD have been removed

    // Verify shutdown was initiated
    expect(shutdownStarted).toBe(true)
    // Shutdown is async, so it shouldn't have completed yet in the same tick
    expect(shutdownCompleted).toBe(false)

    const storeOrPromise = registry.getOrLoad(options)

    if (!(storeOrPromise instanceof Promise)) {
      expect.fail('getOrLoad returned dying store synchronously instead of starting fresh load')
    }

    const freshStore = await storeOrPromise
    // A fresh load was triggered because cache was cleared
    expect(freshStore).not.toBe(originalStore)
    await freshStore.shutdownPromise()
  })

  it('warms the cache so subsequent getOrLoad is synchronous after preload', async () => {
    const registry = new StoreRegistry()
    const options = testStoreOptions()

    // Preload the store
    await registry.preload(options)

    // Subsequent getOrLoad should return synchronously (not a Promise)
    const store = registry.getOrLoad(options)
    expect(store).not.toBeInstanceOf(Promise)

    // TypeScript doesn't narrow the type, so we need to assert
    if (store instanceof Promise) {
      throw new Error('Expected store, got Promise')
    }

    // Clean up
    await store.shutdownPromise()
  })

  it('schedules disposal after preload if no subscribers are added', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const unusedCacheTime = 50
    const options = testStoreOptions({ unusedCacheTime })

    // Preload without subscribing
    await registry.preload(options)

    // Get the store
    const store = registry.getOrLoad(options)
    expect(store).not.toBeInstanceOf(Promise)

    // Advance time to trigger disposal
    await vi.advanceTimersByTimeAsync(unusedCacheTime)

    // Store should be disposed since no subscribers were added
    const nextStore = await registry.getOrLoad(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })
})

const testStoreOptions = (overrides: Partial<CachedStoreOptions<typeof schema>> = {}) =>
  storeOptions({
    storeId: 'test-store',
    schema,
    adapter: makeInMemoryAdapter(),
    ...overrides,
  })
