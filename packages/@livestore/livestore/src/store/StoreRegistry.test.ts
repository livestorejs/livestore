import { describe, expect, it } from '@effect/vitest'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { OtelLiveDummy, UnknownError } from '@livestore/common'
import { Effect, Fiber, type OtelTracer, type Scope, TestClock } from '@livestore/utils/effect'

import { schema } from '../utils/tests/fixture.ts'
import { StoreInternalsSymbol } from './store-types.ts'
import { type RegistryStoreOptions, StoreRegistry, storeOptions } from './StoreRegistry.ts'

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

  it.layer(OtelLiveDummy)('time-dependent (using TestClock)', (it) => {
    it.scoped('disposes store after unusedCacheTime expires', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 25
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })
        const options = testStoreOptions()

        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        // Store should still be in cache
        const cached = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(cached).toBe(store)

        // Let the idle timer fiber register its sleep with TestClock
        yield* Effect.yieldNow()

        // Advance time past unusedCacheTime → idle timer fires → entry evicted
        yield* TestClock.adjust(unusedCacheTime)

        // After eviction, a new load should produce a different store
        const nextStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(nextStore).not.toBe(store)
        expect(nextStore[StoreInternalsSymbol].clientSession.debugInstanceId).toBeDefined()
      }),
    )

    it.scoped('does not dispose when unusedCacheTime is Infinity', () =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime: Number.POSITIVE_INFINITY } })
        const options = testStoreOptions()

        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        // Advance a large amount of time — no idle timer was started for Infinity
        yield* TestClock.adjust(100_000)

        // Store should still be cached
        const cached = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(cached).toBe(store)
      }),
    )

    it.scoped('schedules disposal if store becomes unused during loading', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 50
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })
        const options = testStoreOptions()

        // Load without retaining — disposal is scheduled when scope closes
        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        yield* Effect.yieldNow()
        yield* TestClock.adjust(unusedCacheTime)

        // Store should be disposed
        const nextStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(nextStore).not.toBe(store)
      }),
    )

    it.scoped('allows call-site options to override default options', () =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime: 10_000 } }) // Long default

        const unusedCacheTimeOverride = 25
        const options = testStoreOptions({ unusedCacheTime: unusedCacheTimeOverride })

        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        yield* Effect.yieldNow()
        yield* TestClock.adjust(unusedCacheTimeOverride)

        // Should be disposed according to the override time, not default
        const nextStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(nextStore).not.toBe(store)
      }),
    )

    it.scoped('disposes different stores according to their own unusedCacheTime', () =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime: 1000 } })

        const shortOptions = testStoreOptions({ storeId: 'short-lived', unusedCacheTime: 25 })
        const longOptions = testStoreOptions({ storeId: 'long-lived', unusedCacheTime: 10_000 })

        const shortStore = yield* registry.getOrLoad(shortOptions).pipe(Effect.scoped)
        const longStore = yield* registry.getOrLoad(longOptions).pipe(Effect.scoped)

        yield* Effect.yieldNow()

        // Advance past short store's unusedCacheTime only
        yield* TestClock.adjust(25)

        // Short store should be disposed, long store should still be cached
        const nextShortStore = yield* registry.getOrLoad(shortOptions).pipe(Effect.scoped)
        expect(nextShortStore).not.toBe(shortStore)

        const cachedLongStore = yield* registry.getOrLoad(longOptions).pipe(Effect.scoped)
        expect(cachedLongStore).toBe(longStore)
      }),
    )

    // This test is skipped because we don't yet support dynamic `unusedCacheTime` updates for cached stores.
    // See https://github.com/livestorejs/livestore/issues/918
    it.scoped.skip('keeps the longest unusedCacheTime seen for a store when options vary across calls', () =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime })

        const options = testStoreOptions({ unusedCacheTime: 10 })
        const release = registry.retain(options)

        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        // Call with longer unusedCacheTime
        yield* registry.getOrLoad(testStoreOptions({ unusedCacheTime: 100 })).pipe(Effect.scoped)

        release()
        yield* Effect.yieldNow()

        // After 99ms, store should still be alive (100ms unusedCacheTime used)
        yield* TestClock.adjust(99)

        const cached = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(cached).toBe(store)

        // After 1 more ms, store should be disposed
        yield* TestClock.adjust(1)

        const nextStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(nextStore).not.toBe(store)
      }),
    )

    it.scoped('handles rapid retain/release cycles without errors', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 50
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })
        const options = testStoreOptions()

        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        // Rapidly retain and release multiple times
        for (let i = 0; i < 10; i++) {
          const release = registry.retain(options)
          release()
        }

        yield* Effect.yieldNow()
        yield* TestClock.adjust(unusedCacheTime)

        // Store should be disposed after the last release
        const nextStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(nextStore).not.toBe(store)
      }),
    )

    it.scoped('cancels disposal when new retain', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 50
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })
        const options = testStoreOptions()

        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        yield* Effect.yieldNow()

        // Advance almost to disposal threshold
        yield* TestClock.adjust(unusedCacheTime - 5)

        // Add a new retain before disposal triggers
        const release = registry.retain(options)

        // Complete the original unusedCacheTime
        yield* TestClock.adjust(5)

        // Store should not have been disposed because retain keeps it alive
        const cached = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(cached).toBe(store)

        // Release retain — new idle timer starts
        release()
        yield* Effect.yieldNow()

        yield* TestClock.adjust(unusedCacheTime)

        // Now it should be disposed
        const nextStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(nextStore).not.toBe(store)
      }),
    )

    it.scoped('aborts loading when disposal fires while store is still loading', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 10
        const loadDelay = 1000
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })

        // Adapter that takes time to load (controlled by TestClock)
        const baseAdapter = makeInMemoryAdapter()
        const options = testStoreOptions({
          adapter: ((args: any) =>
            Effect.gen(function* () {
              yield* Effect.sleep(loadDelay)
              return yield* baseAdapter(args)
            })) as any,
        })

        // Retain triggers loading (won't complete until clock advances past loadDelay)
        const release = registry.retain(options)
        yield* Effect.yieldNow()

        // Release immediately — schedules disposal after unusedCacheTime
        release()
        yield* Effect.yieldNow()

        // Advance past unusedCacheTime but NOT past loadDelay → disposal fires, interrupts loading
        yield* TestClock.adjust(unusedCacheTime)

        // Start a fresh load — since the first was aborted, this should be a new entry
        const freshLoadFiber = yield* Effect.fork(registry.getOrLoad(options).pipe(Effect.scoped))
        yield* Effect.yieldNow()

        // Advance enough for the fresh load to complete
        yield* TestClock.adjust(loadDelay)
        const store = yield* Fiber.join(freshLoadFiber)

        expect(store).toBeDefined()
      }),
    )

    it.scoped('retain keeps store alive past unusedCacheTime', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 50
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })
        const options = testStoreOptions()

        // Load the store
        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        // Retain the store before disposal could fire
        const release = registry.retain(options)

        yield* Effect.yieldNow()

        // Advance past unusedCacheTime — idle timer fires but refCount > 0, so no eviction
        yield* TestClock.adjust(unusedCacheTime + 50)

        // Store should still be cached because retain keeps it alive
        const cached = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(cached).toBe(store)

        release()
      }),
    )

    it.scoped('manages multiple stores with different IDs independently', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 50
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })

        const options1 = testStoreOptions({ storeId: 'store-1' })
        const options2 = testStoreOptions({ storeId: 'store-2' })

        const store1 = yield* registry.getOrLoad(options1).pipe(Effect.scoped)
        const store2 = yield* registry.getOrLoad(options2).pipe(Effect.scoped)

        // Should be different store instances
        expect(store1).not.toBe(store2)

        // Both should be cached independently
        const cached1 = yield* registry.getOrLoad(options1).pipe(Effect.scoped)
        const cached2 = yield* registry.getOrLoad(options2).pipe(Effect.scoped)
        expect(cached1).toBe(store1)
        expect(cached2).toBe(store2)

        yield* Effect.yieldNow()
        yield* TestClock.adjust(unusedCacheTime)

        // Both stores should be disposed
        const newStore1 = yield* registry.getOrLoad(options1).pipe(Effect.scoped)
        const newStore2 = yield* registry.getOrLoad(options2).pipe(Effect.scoped)
        expect(newStore1).not.toBe(store1)
        expect(newStore2).not.toBe(store2)
      }),
    )

    it.scoped('applies default options from constructor', () =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime: 100 } })
        const options = testStoreOptions()

        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        // Verify the store loads successfully
        expect(store).toBeDefined()
        expect(store[StoreInternalsSymbol].clientSession.debugInstanceId).toBeDefined()

        yield* Effect.yieldNow()

        // After 50ms, store should still be cached (default is 100ms)
        yield* TestClock.adjust(50)

        const cached = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(cached).toBe(store)
      }),
    )

    it.scoped('does not serve a disposed store from cache', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 25
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })
        const options = testStoreOptions()

        const originalStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        // Verify store is cached
        const cached = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(cached).toBe(originalStore)

        yield* Effect.yieldNow()
        yield* TestClock.adjust(unusedCacheTime)

        // After disposal, calling getOrLoad should produce a fresh store
        const freshStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(freshStore).not.toBe(originalStore)
      }),
    )

    it.scoped('schedules disposal after preload if no retainers are added', () =>
      Effect.gen(function* () {
        const unusedCacheTime = 50
        const runtime = yield* Effect.runtime<Scope.Scope | OtelTracer.OtelTracer>()
        const registry = new StoreRegistry({ runtime, defaultOptions: { unusedCacheTime } })
        const options = testStoreOptions()

        // Preload without retaining (load + immediate release)
        const store = yield* registry.getOrLoad(options).pipe(Effect.scoped)

        // Verify it's cached
        const cached = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(cached).toBe(store)

        yield* Effect.yieldNow()
        yield* TestClock.adjust(unusedCacheTime)

        // Store should be disposed since no retainers were added
        const nextStore = yield* registry.getOrLoad(options).pipe(Effect.scoped)
        expect(nextStore).not.toBe(store)
      }),
    )
  })
})

const testStoreOptions = (overrides: Partial<RegistryStoreOptions<typeof schema>> = {}) =>
  storeOptions({
    storeId: 'test-store',
    schema,
    adapter: makeInMemoryAdapter(),
    ...overrides,
  })
