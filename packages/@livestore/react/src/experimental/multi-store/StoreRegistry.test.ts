import type { LiveStoreSchema } from '@livestore/common/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedStoreOptions } from './types.ts'

vi.mock('@livestore/livestore', () => ({
  createStorePromise: vi.fn(),
}))

import { createStorePromise, type Store } from '@livestore/livestore'
import { StoreRegistry } from './StoreRegistry.ts'

type TestSchema = LiveStoreSchema.Any

const mockedCreateStorePromise = vi.mocked(createStorePromise)

describe('StoreRegistry', () => {
  beforeEach(() => {
    mockedCreateStorePromise.mockReset()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('returns a Promise when the store is loading', () => {
    const registry = new StoreRegistry()
    const { promise } = createDeferred<Store<TestSchema>>()
    mockedCreateStorePromise.mockReturnValueOnce(promise)

    const result = registry.getOrLoad(makeOptions())

    expect(result).toBeInstanceOf(Promise)
    expect(mockedCreateStorePromise).toHaveBeenCalledTimes(1)
  })

  it('returns cached store synchronously after first load resolves', async () => {
    const registry = new StoreRegistry()
    const store = createTestStore()
    mockedCreateStorePromise.mockResolvedValueOnce(store)

    const initial = registry.getOrLoad(makeOptions())
    expect(initial).toBeInstanceOf(Promise)

    await expect(initial).resolves.toBe(store)

    const cached = registry.getOrLoad(makeOptions())
    expect(cached).toBe(store)
    expect(mockedCreateStorePromise).toHaveBeenCalledTimes(1)
  })

  it('reuses the same promise for concurrent getOrLoad calls while loading', async () => {
    const registry = new StoreRegistry()
    const store = createTestStore()
    const deferred = createDeferred<typeof store>()
    mockedCreateStorePromise.mockReturnValueOnce(deferred.promise)

    const options = makeOptions()
    const first = registry.getOrLoad(options)
    const second = registry.getOrLoad(options)

    expect(first).toBe(second)
    expect(mockedCreateStorePromise).toHaveBeenCalledTimes(1)

    deferred.resolve(store)
    await expect(first).resolves.toBe(store)
  })

  it('stores and rethrows the rejection on subsequent getOrLoad calls after a failure', async () => {
    const registry = new StoreRegistry()
    const error = new Error('load failed')
    mockedCreateStorePromise.mockRejectedValueOnce(error)

    await expect(registry.getOrLoad(makeOptions())).rejects.toBe(error)
    expect(mockedCreateStorePromise).toHaveBeenCalledTimes(1)

    expect(() => registry.getOrLoad(makeOptions())).toThrow(error)
    expect(mockedCreateStorePromise).toHaveBeenCalledTimes(1)
  })

  it('disposes store after gc timeout expires', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const gcTime = 25
    const options = makeOptions({ gcTime })
    const store = createTestStore()
    const shutdownSpy = store.shutdownPromise as unknown as ReturnType<typeof vi.fn>
    mockedCreateStorePromise.mockResolvedValueOnce(store)

    await registry.getOrLoad(options)
    await vi.advanceTimersByTimeAsync(gcTime)
    await Promise.resolve()

    expect(shutdownSpy).toHaveBeenCalledTimes(1)

    const nextStore = createTestStore()
    mockedCreateStorePromise.mockResolvedValueOnce(nextStore)
    await registry.getOrLoad(options)
    expect(mockedCreateStorePromise).toHaveBeenCalledTimes(2)
  })

  it('keeps the longest gcTime seen for a store when options vary across calls', async () => {
    vi.useFakeTimers()
    const registry = new StoreRegistry()
    const store = createTestStore()
    const shutdownSpy = store.shutdownPromise as unknown as ReturnType<typeof vi.fn>
    mockedCreateStorePromise.mockResolvedValue(store)

    const options = makeOptions({ gcTime: 10 })
    const unsubscribe = registry.subscribe(options.storeId, () => {})

    await registry.getOrLoad(options)

    await registry.getOrLoad(makeOptions({ gcTime: 100 }))

    unsubscribe()

    await vi.advanceTimersByTimeAsync(99)
    expect(shutdownSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    expect(shutdownSpy).toHaveBeenCalledTimes(1)
  })

  it('preload does not throw', async () => {
    const registry = new StoreRegistry()
    const error = new Error('preload failed')
    mockedCreateStorePromise.mockRejectedValueOnce(error)

    await expect(registry.preload(makeOptions())).resolves.toBeUndefined()
    expect(mockedCreateStorePromise).toHaveBeenCalledTimes(1)

    expect(() => registry.getOrLoad(makeOptions())).toThrow(error)
    expect(mockedCreateStorePromise).toHaveBeenCalledTimes(1)
  })
})

const baseSchema = {} as TestSchema
const baseAdapter = {} as CachedStoreOptions<TestSchema>['adapter']

const makeOptions = (overrides: Partial<CachedStoreOptions<TestSchema>> = {}): CachedStoreOptions<TestSchema> => ({
  storeId: 'test-store',
  schema: baseSchema,
  adapter: baseAdapter,
  gcTime: 50,
  ...overrides,
})

const createTestStore = () =>
  ({
    shutdownPromise: vi.fn().mockResolvedValue(undefined),
  }) as unknown as Store<TestSchema>

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
