import { makeInMemoryAdapter } from '@livestore/adapter-web'
import {
  queryDb,
  type RegistryStoreOptions,
  type Store,
  StoreInternalsSymbol,
  StoreRegistry,
  storeOptions,
} from '@livestore/livestore'
import { Schema } from '@livestore/utils/effect'
import * as SolidTesting from '@solidjs/testing-library'
import * as Solid from 'solid-js'
import { describe, expect, it } from 'vitest'
import { events, schema, tables } from './__tests__/fixture.tsx'
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

  it('works with Suspense boundary', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const StoreConsumer = (props: { options: RegistryStoreOptions<typeof schema> }) => {
      useStore(() => props.options)
      return <div data-testid="ready" />
    }

    const { findByTestId, queryByTestId } = SolidTesting.render(() => (
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <Solid.Suspense fallback={<div data-testid="fallback" />}>
          <StoreConsumer options={options} />
        </Solid.Suspense>
      </StoreRegistryProvider>
    ))

    // After loading completes, should show the actual content
    await findByTestId('ready')
    expect(queryByTestId('fallback')).toBeNull()

    await cleanupAfterUnmount(() => {})
  })

  it('does not re-suspend on subsequent renders when store is already loaded', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const [currentOptions, setCurrentOptions] = Solid.createSignal(options)

    const StoreConsumer = (props: { options: () => RegistryStoreOptions<typeof schema> }) => {
      useStore(props.options)
      return <div data-testid="ready" />
    }

    const { findByTestId, queryByTestId } = SolidTesting.render(() => (
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <Solid.Suspense fallback={<div data-testid="fallback" />}>
          <StoreConsumer options={currentOptions} />
        </Solid.Suspense>
      </StoreRegistryProvider>
    ))

    // Wait for initial load
    await findByTestId('ready')
    expect(queryByTestId('fallback')).toBeNull()

    // Update with new options object (but same storeId) - this triggers reactivity
    setCurrentOptions({ ...options })

    // Should not show fallback - store is already cached
    expect(queryByTestId('fallback')).toBeNull()
    expect(queryByTestId('ready')).not.toBeNull()

    await cleanupAfterUnmount(() => {})
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
    const [currentOptions, setCurrentOptions] = Solid.createSignal<RegistryStoreOptions<typeof schema>>(optionsA)

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

  // useStore doesn't handle unusedCacheTime=0 correctly because retain is called in createComputed (after resource fetch)
  // See https://github.com/livestorejs/livestore/issues/916
  it.skip('should load store with unusedCacheTime set to 0', async () => {
    // Skipped: retain timing issue with unusedCacheTime=0
  })
})

describe('useStore.useQuery', () => {
  it('returns undefined before store is loaded, then returns result', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

    const { result } = SolidTesting.renderHook(
      () => {
        const store = useStore(() => options)
        return store.useQuery(allTodos$)
      },
      { wrapper: makeProvider(storeRegistry) },
    )

    // Wait for store to load and query to return results
    await SolidTesting.waitFor(() => {
      expect(result()).toBeDefined()
    })

    expect(result()).toEqual([])

    await cleanupAfterUnmount(() => {})
  })

  it('updates when store changes', async () => {
    const storeRegistry = new StoreRegistry()
    const optionsA = testStoreOptions({ storeId: 'store-a' })
    const optionsB = testStoreOptions({ storeId: 'store-b' })

    const [currentOptions, setCurrentOptions] = Solid.createSignal(optionsA)

    const allTodos$ = queryDb(
      { query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) },
      { label: 'allTodos' },
    )

    const { result } = SolidTesting.renderHook(
      () => {
        const store = useStore(currentOptions)
        return { store, todos: store.useQuery(allTodos$) }
      },
      { wrapper: makeProvider(storeRegistry) },
    )

    // Wait for store A to load
    await SolidTesting.waitFor(() => {
      expect(result.store()).toBeDefined()
    })

    // Add todo to store A
    result.store()!.commit(events.todoCreated({ id: 't1', text: 'store A todo', completed: false }))
    expect(result.todos()?.length).toBe(1)
    expect(result.todos()?.[0]?.text).toBe('store A todo')

    // Switch to store B
    setCurrentOptions(optionsB)

    // Wait for store B to load
    await SolidTesting.waitFor(() => {
      expect(result.store()?.storeId).toBe('store-b')
    })

    // Store B should have no todos (it's a fresh store)
    expect(result.todos()).toEqual([])

    // Add todo to store B
    result.store()!.commit(events.todoCreated({ id: 't2', text: 'store B todo', completed: false }))
    expect(result.todos()?.length).toBe(1)
    expect(result.todos()?.[0]?.text).toBe('store B todo')

    await cleanupAfterUnmount(() => {})
  })

  it('updates reactively when data changes', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const allTodos$ = queryDb(
      { query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) },
      { label: 'allTodos' },
    )

    const { result } = SolidTesting.renderHook(
      () => {
        const store = useStore(() => options)
        return { store, todos: store.useQuery(allTodos$) }
      },
      { wrapper: makeProvider(storeRegistry) },
    )

    // Wait for store to load
    await SolidTesting.waitFor(() => {
      expect(result.store()).toBeDefined()
    })

    expect(result.todos()).toEqual([])

    // Add a todo
    result.store()!.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))

    expect(result.todos()?.length).toBe(1)
    expect(result.todos()?.[0]?.text).toBe('buy milk')

    await cleanupAfterUnmount(() => {})
  })
})

describe('useStore.useClientDocument', () => {
  it('returns state accessor and setter', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const { result } = SolidTesting.renderHook(
      () => {
        const store = useStore(() => options)
        const [state, setState, id] = store.useClientDocument(tables.userInfo, 'u1')
        return { store, state, setState, id }
      },
      { wrapper: makeProvider(storeRegistry) },
    )

    // Wait for store to load
    await SolidTesting.waitFor(() => {
      expect(result.store()).toBeDefined()
    })

    expect(result.id()).toBe('u1')
    expect(result.state()?.username).toBe('')

    // Update via setState
    result.setState({ username: 'test-user' })

    expect(result.state()?.username).toBe('test-user')

    await cleanupAfterUnmount(() => {})
  })

  it('setter works with multiple updates', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const { result } = SolidTesting.renderHook(
      () => {
        const store = useStore(() => options)
        const [state, setState, id] = store.useClientDocument(tables.userInfo, 'u1')
        return { store, state, setState, id }
      },
      { wrapper: makeProvider(storeRegistry) },
    )

    // Wait for store to load first
    await SolidTesting.waitFor(() => {
      expect(result.store()).toBeDefined()
    })

    // Multiple setState calls should work
    result.setState({ username: 'first' })
    expect(result.state()?.username).toBe('first')

    result.setState({ username: 'second' })
    expect(result.state()?.username).toBe('second')

    result.setState({ username: 'third', text: 'hello' })
    expect(result.state()?.username).toBe('third')
    expect(result.state()?.text).toBe('hello')

    await cleanupAfterUnmount(() => {})
  })

  it('buffers state when called before store loads', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const { result } = SolidTesting.renderHook(
      () => {
        const store = useStore(() => options)
        const [state, setState, id] = store.useClientDocument(tables.userInfo, 'u1')
        return { store, state, setState, id }
      },
      { wrapper: makeProvider(storeRegistry) },
    )

    // Call setState BEFORE store is loaded - should buffer
    result.setState({ username: 'buffered', text: 'test' })

    // The buffered state should be synced
    expect(result.state().username).toBe('buffered')

    // Wait for store to load
    await SolidTesting.waitFor(() => {
      expect(result.store()).toBeDefined()
    })

    // The buffered state should be synced
    expect(result.state().username).toBe('buffered')

    // Now update again - this should overwrite
    result.setState({ username: 'updated', text: 'test2' })
    expect(result.state()?.username).toBe('updated')

    await cleanupAfterUnmount(() => {})
  })

  it('updates reactively via raw store commit', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const { result } = SolidTesting.renderHook(
      () => {
        const store = useStore(() => options)
        const [state, setState, id] = store.useClientDocument(tables.userInfo, 'u1')
        return { store, state, setState, id }
      },
      { wrapper: makeProvider(storeRegistry) },
    )

    // Wait for store to load
    await SolidTesting.waitFor(() => {
      expect(result.store()).toBeDefined()
    })

    expect(result.state()?.username).toBe('')

    // Update via raw store commit
    result.store()!.commit(events.UserInfoSet({ username: 'commit-user', text: 'hello' }, 'u1'))

    expect(result.state()?.username).toBe('commit-user')

    await cleanupAfterUnmount(() => {})
  })

  it('updates when store changes', async () => {
    const storeRegistry = new StoreRegistry()
    const optionsA = testStoreOptions({ storeId: 'store-a' })
    const optionsB = testStoreOptions({ storeId: 'store-b' })

    const [currentOptions, setCurrentOptions] = Solid.createSignal(optionsA)

    const { result } = SolidTesting.renderHook(
      () => {
        const store = useStore(currentOptions)
        const [state, setState, id] = store.useClientDocument(tables.userInfo, 'u1')
        return { store, state, setState, id }
      },
      { wrapper: makeProvider(storeRegistry) },
    )

    // Wait for store A to load
    await SolidTesting.waitFor(() => {
      expect(result.store()).toBeDefined()
    })

    // Set username in store A
    result.setState({ username: 'store-a-user', text: 'hello from A' })
    expect(result.state()?.username).toBe('store-a-user')

    // Switch to store B
    setCurrentOptions(optionsB)

    // Wait for store B to load
    await SolidTesting.waitFor(() => {
      expect(result.store()?.storeId).toBe('store-b')
    })

    // Store B should have default/empty state (fresh store)
    expect(result.state()?.username).toBe('')

    // Set username in store B
    result.setState({ username: 'store-b-user', text: 'hello from B' })
    expect(result.state()?.username).toBe('store-b-user')

    // Switch back to store A
    setCurrentOptions(optionsA)

    // Wait for store A to load
    await SolidTesting.waitFor(() => {
      expect(result.store()?.storeId).toBe('store-a')
    })

    // Store A should still have its original data
    expect(result.state()?.username).toBe('store-a-user')

    await cleanupAfterUnmount(() => {})
  })
})

const makeProvider = (storeRegistry: StoreRegistry) => (props: { children: Solid.JSX.Element }) => {
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
