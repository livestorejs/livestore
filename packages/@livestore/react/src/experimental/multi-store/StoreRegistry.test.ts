import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../../__tests__/fixture.tsx'
import { StoreRegistry } from './StoreRegistry.ts'
import type { CachedStoreOptions } from './types.ts'

type TestSchema = typeof schema

describe('StoreRegistry', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('returns a Promise when the store is loading', async () => {
    const registry = new StoreRegistry()
    const result = registry.getOrLoad(makeOptions())

    expect(result).toBeInstanceOf(Promise)

    // Clean up
    const store = await result
    await store.shutdownPromise()
  })

  it('returns cached store synchronously after first load resolves', async () => {
    const registry = new StoreRegistry()

    const initial = registry.getOrLoad(makeOptions())
    expect(initial).toBeInstanceOf(Promise)

    const store = await initial

    const cached = registry.getOrLoad(makeOptions())
    expect(cached).toBe(store)
    expect(cached).not.toBeInstanceOf(Promise)

    // Clean up
    await store.shutdownPromise()
  })

  it('reuses the same promise for concurrent getOrLoad calls while loading', async () => {
    const registry = new StoreRegistry()
    const options = makeOptions()

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
    const badOptions = makeOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    await expect(registry.getOrLoad(badOptions)).rejects.toThrow()

    // Subsequent call should throw the cached error synchronously
    expect(() => registry.getOrLoad(badOptions)).toThrow()
  })

  it('disposes store after gc timeout expires', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const gcTime = 25
    const options = makeOptions({ gcTime })

    const store = await registry.getOrLoad(options)

    // Store should be cached
    expect(registry.getOrLoad(options)).toBe(store)

    // Advance time to trigger GC
    await vi.advanceTimersByTimeAsync(gcTime)
    await Promise.resolve()

    // After GC, store should be disposed and queries should fail
    // The store is removed from cache, so next getOrLoad creates a new one
    const nextStore = await registry.getOrLoad(options)

    // Should be a different store instance
    expect(nextStore).not.toBe(store)
    expect(nextStore.clientSession.debugInstanceId).toBeDefined()

    // Clean up the second store (first one was cleaned up by GC)
    await nextStore.shutdownPromise()
  })

  it('keeps the longest gcTime seen for a store when options vary across calls', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()

    const options = makeOptions({ gcTime: 10 })
    const unsubscribe = registry.subscribe(options.storeId, () => {})

    const store = await registry.getOrLoad(options)

    // Call with longer gcTime
    await registry.getOrLoad(makeOptions({ gcTime: 100 }))

    unsubscribe()

    // After 99ms, store should still be alive (100ms gcTime used)
    await vi.advanceTimersByTimeAsync(99)

    // Store should still be cached
    expect(registry.getOrLoad(options)).toBe(store)

    // After the full 100ms, store should be disposed
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()

    // Next getOrLoad should create a new store
    const nextStore = await registry.getOrLoad(options)
    expect(nextStore).not.toBe(store)

    // Clean up the second store (first one was cleaned up by GC)
    await nextStore.shutdownPromise()
  })

  it('preload does not throw', async () => {
    const registry = new StoreRegistry()

    // Create invalid options that would cause an error
    const badOptions = makeOptions({
      // @ts-expect-error - intentionally passing invalid adapter to trigger error
      adapter: null,
    })

    // preload should not throw
    await expect(registry.preload(badOptions)).resolves.toBeUndefined()

    // But subsequent getOrLoad should throw the cached error
    expect(() => registry.getOrLoad(badOptions)).toThrow()
  })
})

const makeOptions = (overrides: Partial<CachedStoreOptions<TestSchema>> = {}): CachedStoreOptions<TestSchema> => ({
  storeId: 'test-store',
  schema,
  adapter: makeInMemoryAdapter(),
  gcTime: 50,
  ...overrides,
})
