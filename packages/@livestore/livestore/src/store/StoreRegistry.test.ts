import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { UnknownError } from '@livestore/common'
import { sleep } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import { schema } from '../utils/tests/fixture.ts'
import { StoreRegistry } from './StoreRegistry.ts'
import { StoreInternalsSymbol } from './store-types.ts'
import { storeOptions } from './storeOptions.ts'
import type { RegistryStoreOptions } from './types.ts'

describe('StoreRegistry', () => {
  it('returns a promise when the store is loading', async () => {
    const storeRegistry = new StoreRegistry()
    const result = storeRegistry.getOrLoadPromise(testStoreOptions())

    expect(result).toBeInstanceOf(Promise)

    // Clean up
    const store = await result
    await store.shutdownPromise()
  })

  it('returns cached store synchronously after first load resolves', async () => {
    const storeRegistry = new StoreRegistry()

    const initial = storeRegistry.getOrLoadPromise(testStoreOptions())
    expect(initial).toBeInstanceOf(Promise)

    const store = await initial

    const cached = storeRegistry.getOrLoadPromise(testStoreOptions())
    expect(cached).toBe(store)
    expect(cached).not.toBeInstanceOf(Promise)

    // Clean up
    await store.shutdownPromise()
  })

  it('reuses the same promise for concurrent getOrLoadPromise calls while loading', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const first = storeRegistry.getOrLoadPromise(options)
    const second = storeRegistry.getOrLoadPromise(options)

    // Both should be the same promise
    expect(first).toBe(second)
    expect(first).toBeInstanceOf(Promise)

    const store = await first

    // Both promises should resolve to the same store
    expect(await second).toBe(store)

    // Clean up
    await store.shutdownPromise()
  })

  it('throws synchronously and rethrows on subsequent calls for sync failures', () => {
    const storeRegistry = new StoreRegistry()

    const badOptions = testStoreOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    // First call throws synchronously
    expect(() => storeRegistry.getOrLoadPromise(badOptions)).toThrow()

    // Subsequent call should also throw synchronously (cached error)
    expect(() => storeRegistry.getOrLoadPromise(badOptions)).toThrow()
  })

  it('caches and rethrows rejection on subsequent calls for async failures', async () => {
    const storeRegistry = new StoreRegistry()

    // Create an adapter that fails asynchronously (after yielding to the event loop)
    const failingAdapter = () =>
      Effect.gen(function* () {
        yield* Effect.sleep(0) // Force async execution
        return yield* UnknownError.make({ cause: new Error('Async failure') })
      })
    const badOptions = testStoreOptions({
      adapter: failingAdapter,
    })

    // First call returns a promise that rejects
    await expect(storeRegistry.getOrLoadPromise(badOptions)).rejects.toThrow()

    // Subsequent call should throw the cached error synchronously (RcMap caches failures)
    expect(() => storeRegistry.getOrLoadPromise(badOptions)).toThrow()
  })

  it('throws the same error instance on multiple calls after failure', async () => {
    const storeRegistry = new StoreRegistry()

    // Create an adapter that fails asynchronously
    const failingAdapter = () =>
      Effect.gen(function* () {
        yield* Effect.sleep(0) // Force async execution
        return yield* UnknownError.make({ cause: new Error('Async failure') })
      })

    const badOptions = testStoreOptions({
      adapter: failingAdapter,
    })

    // Wait for the first failure
    await expect(storeRegistry.getOrLoadPromise(badOptions)).rejects.toThrow()

    // Capture the errors from subsequent calls
    let error1: unknown
    let error2: unknown

    try {
      storeRegistry.getOrLoadPromise(badOptions)
    } catch (err) {
      error1 = err
    }

    try {
      storeRegistry.getOrLoadPromise(badOptions)
    } catch (err) {
      error2 = err
    }

    // Both should be the exact same error instance (cached)
    expect(error1).toBeDefined()
    expect(error1).toBe(error2)
  })

  it('disposes store after unusedCacheTime expires', async () => {
    const unusedCacheTime = 25
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })
    const options = testStoreOptions()

    const store = await storeRegistry.getOrLoadPromise(options)

    // Store should be cached
    expect(storeRegistry.getOrLoadPromise(options)).toBe(store)

    // Wait for disposal
    await sleep(unusedCacheTime + 50)

    // After disposal, store should be removed
    // The store is removed from cache, so next getOrLoadStore creates a new one
    const nextStore = await storeRegistry.getOrLoadPromise(options)

    // Should be a different store instance
    expect(nextStore).not.toBe(store)
    expect(nextStore[StoreInternalsSymbol].clientSession.debugInstanceId).toBeDefined()

    // Clean up the second store (first one was disposed)
    await nextStore.shutdownPromise()
  })

  it('does not dispose when unusedCacheTime is Infinity', async () => {
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime: Number.POSITIVE_INFINITY } })
    const options = testStoreOptions()

    const store = await storeRegistry.getOrLoadPromise(options)

    // Store should be cached
    expect(storeRegistry.getOrLoadPromise(options)).toBe(store)

    // Wait a reasonable duration to verify no disposal
    await sleep(100)

    // Store should still be cached (not disposed)
    expect(storeRegistry.getOrLoadPromise(options)).toBe(store)

    // Clean up manually
    await store.shutdownPromise()
  })

  it('schedules disposal if store becomes unused during loading', async () => {
    const unusedCacheTime = 50
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })
    const options = testStoreOptions()

    // Start loading without any retain
    const storePromise = storeRegistry.getOrLoadPromise(options)

    // Wait for store to load (no retain registered)
    const store = await storePromise

    // Since there were no retain when loading completed, disposal should be scheduled
    await sleep(unusedCacheTime + 50)

    // Store should be disposed
    const nextStore = await storeRegistry.getOrLoadPromise(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })

  // This test is skipped because Effect doesn't yet support different `idleTimeToLive` values for each resource in `RcMap`
  // See https://github.com/livestorejs/livestore/issues/917
  it.skip('allows call-site options to override default options', async () => {
    const storeRegistry = new StoreRegistry({
      defaultOptions: {
        unusedCacheTime: 1000, // Default is long
      },
    })

    const options = testStoreOptions({
      unusedCacheTime: 10, // Override with shorter time
    })

    const store = await storeRegistry.getOrLoadPromise(options)

    // Wait for the override time (10ms)
    await sleep(10)

    // Should be disposed according to the override time, not default
    const nextStore = await storeRegistry.getOrLoadPromise(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })

  // This test is skipped because we don't yet support dynamic `unusedCacheTime` updates for cached stores.
  // See https://github.com/livestorejs/livestore/issues/918
  it.skip('keeps the longest unusedCacheTime seen for a store when options vary across calls', async () => {
    const storeRegistry = new StoreRegistry()

    const options = testStoreOptions({ unusedCacheTime: 10 })
    const release = storeRegistry.retain(options)

    const store = await storeRegistry.getOrLoadPromise(options)

    // Call with longer unusedCacheTime
    await storeRegistry.getOrLoadPromise(testStoreOptions({ unusedCacheTime: 100 }))

    release()

    // After 99ms, store should still be alive (100ms unusedCacheTime used)
    await sleep(99)

    // Store should still be cached
    expect(storeRegistry.getOrLoadPromise(options)).toBe(store)

    // After the full 100ms, store should be disposed
    await sleep(1)

    // Next getOrLoadStore should create a new store
    const nextStore = await storeRegistry.getOrLoadPromise(options)
    expect(nextStore).not.toBe(store)

    // Clean up the second store (first one was disposed)
    await nextStore.shutdownPromise()
  })

  it('preload does not throw', async () => {
    const storeRegistry = new StoreRegistry()

    // Create invalid options that would cause an error
    const badOptions = testStoreOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    // preload should not throw
    await expect(storeRegistry.preload(badOptions)).resolves.toBeUndefined()

    // But subsequent getOrLoadStore should throw the cached error
    expect(() => storeRegistry.getOrLoadPromise(badOptions)).toThrow()
  })

  it('handles rapid retain/release cycles without errors', async () => {
    const unusedCacheTime = 50
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })
    const options = testStoreOptions()

    const store = await storeRegistry.getOrLoadPromise(options)

    // Rapidly retain and release multiple times
    for (let i = 0; i < 10; i++) {
      const release = storeRegistry.retain(options)
      release()
    }

    // Wait for disposal to trigger
    await sleep(unusedCacheTime + 50)

    // Store should be disposed after the last release
    const nextStore = await storeRegistry.getOrLoadPromise(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })

  it('cancels disposal when new retain', async () => {
    const unusedCacheTime = 50
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })
    const options = testStoreOptions()

    const store = await storeRegistry.getOrLoadPromise(options)

    // Wait almost to disposal threshold
    await sleep(unusedCacheTime - 5)

    // Add a new retain before disposal triggers
    const release = storeRegistry.retain(options)

    // Complete the original unusedCacheTime
    await sleep(5)

    // Store should not have been disposed because we added a retain
    expect(storeRegistry.getOrLoadPromise(options)).toBe(store)

    // Clean up
    release()
    await sleep(unusedCacheTime + 50)

    // Now it should be disposed
    const nextStore = await storeRegistry.getOrLoadPromise(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })

  it('aborts loading when disposal fires while store is still loading', async () => {
    const unusedCacheTime = 10
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })
    const options = testStoreOptions()

    // Retain briefly to trigger getOrLoadStore and then release
    const release = storeRegistry.retain(options)

    // Start loading
    const loadPromise = storeRegistry.getOrLoadPromise(options)

    // Attach a catch handler to prevent unhandled rejection when the load is aborted
    const abortedPromise = (loadPromise as Promise<unknown>).catch(() => {
      // Expected: load was aborted by disposal
    })

    // Release immediately, which schedules disposal
    release()

    // Wait for disposal to trigger
    await sleep(unusedCacheTime + 50)

    // Wait for the abort to complete
    await abortedPromise

    // After abort, a new getOrLoadStore should start a fresh load
    const freshLoadPromise = storeRegistry.getOrLoadPromise(options)

    // This should be a new promise (not the aborted one)
    expect(freshLoadPromise).toBeInstanceOf(Promise)
    expect(freshLoadPromise).not.toBe(loadPromise)

    // Wait for fresh load to complete
    const store = await freshLoadPromise
    expect(store).toBeDefined()

    await store.shutdownPromise()
  })

  it('retain keeps store alive past unusedCacheTime', async () => {
    const unusedCacheTime = 50
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })
    const options = testStoreOptions()

    // Load the store
    const store = await storeRegistry.getOrLoadPromise(options)

    // Retain the store before disposal could fire
    const release = storeRegistry.retain(options)

    // Wait past the unusedCacheTime
    await sleep(unusedCacheTime + 50)

    // Store should still be cached because retain keeps it alive
    const cachedStore = storeRegistry.getOrLoadPromise(options)
    expect(cachedStore).toBe(store)

    release()
    await store.shutdownPromise()
  })

  it('manages multiple stores with different IDs independently', async () => {
    const unusedCacheTime = 50
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })

    const options1 = testStoreOptions({ storeId: 'store-1' })
    const options2 = testStoreOptions({ storeId: 'store-2' })

    const store1 = await storeRegistry.getOrLoadPromise(options1)
    const store2 = await storeRegistry.getOrLoadPromise(options2)

    // Should be different store instances
    expect(store1).not.toBe(store2)

    // Both should be cached independently
    expect(storeRegistry.getOrLoadPromise(options1)).toBe(store1)
    expect(storeRegistry.getOrLoadPromise(options2)).toBe(store2)

    // Wait for both stores to be disposed
    await sleep(unusedCacheTime + 50)

    // Both stores should be disposed, so next getOrLoadStore creates new ones
    const newStore1 = await storeRegistry.getOrLoadPromise(options1)
    expect(newStore1).not.toBe(store1)

    const newStore2 = await storeRegistry.getOrLoadPromise(options2)
    expect(newStore2).not.toBe(store2)

    // Clean up
    await newStore1.shutdownPromise()
    await newStore2.shutdownPromise()
  })

  it('applies default options from constructor', async () => {
    const storeRegistry = new StoreRegistry({
      defaultOptions: {
        unusedCacheTime: 100,
      },
    })

    const options = testStoreOptions()

    const store = await storeRegistry.getOrLoadPromise(options)

    // Verify the store loads successfully
    expect(store).toBeDefined()
    expect(store[StoreInternalsSymbol].clientSession.debugInstanceId).toBeDefined()

    // Verify configured default unusedCacheTime is applied by checking disposal doesn't happen before it
    await sleep(50)

    // Store should still be cached after 50ms (default is 100ms)
    expect(storeRegistry.getOrLoadPromise(options)).toBe(store)

    await store.shutdownPromise()
  })

  it('prevents getOrLoadStore from returning a dying store', async () => {
    const unusedCacheTime = 25
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })
    const options = testStoreOptions()

    // Load the store and wait for it to be ready
    const originalStore = await storeRegistry.getOrLoadPromise(options)

    // Verify store is cached
    expect(storeRegistry.getOrLoadPromise(options)).toBe(originalStore)

    // Wait for disposal to trigger
    await sleep(unusedCacheTime + 50)

    // After disposal, the cache should be cleared
    // Calling getOrLoadStore should start a fresh load (return Promise)
    const storeOrPromise = storeRegistry.getOrLoadPromise(options)

    if (!(storeOrPromise instanceof Promise)) {
      expect.fail('getOrLoadStore returned dying store synchronously instead of starting fresh load')
    }

    const freshStore = await storeOrPromise
    // A fresh load was triggered because cache was cleared
    expect(freshStore).not.toBe(originalStore)
    await freshStore.shutdownPromise()
  })

  it('warms the cache so subsequent getOrLoadStore is synchronous after preload', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    // Preload the store
    await storeRegistry.preload(options)

    // Subsequent getOrLoadStore should return synchronously (not a Promise)
    const store = storeRegistry.getOrLoadPromise(options)
    expect(store).not.toBeInstanceOf(Promise)

    // TypeScript doesn't narrow the type, so we need to assert
    if (store instanceof Promise) {
      throw new Error('Expected store, got Promise')
    }

    // Clean up
    await store.shutdownPromise()
  })

  it('schedules disposal after preload if no retainers are added', async () => {
    const unusedCacheTime = 50
    const storeRegistry = new StoreRegistry({ defaultOptions: { unusedCacheTime } })
    const options = testStoreOptions()

    // Preload without retaining
    await storeRegistry.preload(options)

    // Get the store
    const store = storeRegistry.getOrLoadPromise(options)
    expect(store).not.toBeInstanceOf(Promise)

    // Wait for disposal to trigger
    await sleep(unusedCacheTime + 50)

    // Store should be disposed since no retainers were added
    const nextStore = await storeRegistry.getOrLoadPromise(options)
    expect(nextStore).not.toBe(store)

    await nextStore.shutdownPromise()
  })
})

const testStoreOptions = (overrides: Partial<RegistryStoreOptions<typeof schema>> = {}) =>
  storeOptions({
    storeId: 'test-store',
    schema,
    adapter: makeInMemoryAdapter(),
    ...overrides,
  })
