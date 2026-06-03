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

const suspenseCountById = new Map<string, number>()

const SuspenseFallback = (props: { id: string }) => {
  Solid.onMount(() => {
    suspenseCountById.set(props.id, (suspenseCountById.get(props.id) ?? 0) + 1)
  })

  return <div data-testid={props.id} data-suspense-id={props.id} />
}

const makeSuspenseFallback = (id: string) => {
  return <SuspenseFallback id={id} />
}

const createSuspenseCount = (id: string) => {
  suspenseCountById.set(id, 0)
  const Comp = (props: Solid.ParentProps) => {
    const fallback = makeSuspenseFallback(id)

    return <Solid.Suspense fallback={fallback}>{props.children}</Solid.Suspense>
  }
  return Object.assign(Comp, { count: () => suspenseCountById.get(id) ?? 0, id })
}

describe('useStore', () => {
  it('should return the same promise instance for concurrent getOrLoadStore calls', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const firstStore = storeRegistry.getOrLoadPromise(options)
    const secondStore = storeRegistry.getOrLoadPromise(options)

    expect(firstStore).toBeInstanceOf(Promise)
    expect(secondStore).toBeInstanceOf(Promise)

    expect(firstStore).toBe(secondStore)
  })

  it('triggers Suspense when store() is read', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const RootSuspense = createSuspenseCount('root')
    const ChildSuspense = createSuspenseCount('child')

    const ChildComponent = () => {
      const store = useStore(() => options)
      return (
        <ChildSuspense>
          <div data-testid="ready">Store loaded: {store()?.storeId}</div>
        </ChildSuspense>
      )
    }

    const { findByTestId, queryByTestId } = SolidTesting.render(() => (
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <RootSuspense>
          <ChildComponent />
        </RootSuspense>
      </StoreRegistryProvider>
    ))

    await findByTestId(ChildSuspense.id)
    expect(queryByTestId(RootSuspense.id)).toBeNull()

    await findByTestId('ready')
    expect(queryByTestId(ChildSuspense.id)).toBeNull()

    await cleanupAfterUnmount(() => {})
  })

  it('does not re-suspend on subsequent renders when store is already loaded', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const [currentOptions, setCurrentOptions] = Solid.createSignal(options)

    const RootSuspense = createSuspenseCount('root')
    const ChildSuspense = createSuspenseCount('child')

    const StoreConsumer = (props: { options: () => RegistryStoreOptions<typeof schema> }) => {
      const store = useStore(props.options)
      return (
        <ChildSuspense>
          <div data-testid="ready">Store: {store()?.storeId}</div>
        </ChildSuspense>
      )
    }

    const { findByTestId, queryByTestId } = SolidTesting.render(() => (
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <RootSuspense>
          <StoreConsumer options={currentOptions} />
        </RootSuspense>
      </StoreRegistryProvider>
    ))

    await findByTestId(ChildSuspense.id)
    expect(queryByTestId(RootSuspense.id)).toBeNull()

    // Wait for initial load
    await findByTestId('ready')
    expect(queryByTestId(ChildSuspense.id)).toBeNull()
    expect(queryByTestId(RootSuspense.id)).toBeNull()

    // Update with new options object (but same storeId) - this triggers reactivity
    setCurrentOptions({ ...options })

    // Should not show fallback - store is already cached and returns synchronously
    expect(queryByTestId(ChildSuspense.id)).toBeNull()
    expect(queryByTestId(RootSuspense.id)).toBeNull()
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
    expect(result()?.[StoreInternalsSymbol].clientSession).toBeDefined()

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
  it('Triggers Suspense - returns undefined while store is loading', async () => {
    const storeRegistry = new StoreRegistry()
    const options = testStoreOptions()

    const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

    const RootSuspense = createSuspenseCount('root')
    const UseStoreSuspense = createSuspenseCount('useStore')
    const UseQuerySuspense = createSuspenseCount('useQuery')

    const UseQueryComponent = (props: { store: any }) => {
      const todos = props.store.useQuery(allTodos$)
      return (
        <UseQuerySuspense>
          <div data-testid="content">Todos: {todos()?.length ?? 'loading'}</div>
        </UseQuerySuspense>
      )
    }

    const UseStoreComponent = () => {
      const store = useStore(() => options)
      return (
        <UseStoreSuspense>
          <UseQueryComponent store={store} />
        </UseStoreSuspense>
      )
    }

    const { findByTestId, queryByTestId } = SolidTesting.render(() => (
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <RootSuspense>
          <UseStoreComponent />
        </RootSuspense>
      </StoreRegistryProvider>
    ))

    await findByTestId(UseStoreSuspense.id)
    expect(queryByTestId(RootSuspense.id)).toBeNull()
    expect(queryByTestId(UseQuerySuspense.id)).toBeNull()

    // Wait for store to fully load
    await SolidTesting.waitFor(() => {
      const content = queryByTestId('content')
      expect(content?.textContent).toBe('Todos: 0')
    })

    expect(queryByTestId(RootSuspense.id)).toBeNull()
    expect(queryByTestId(UseStoreSuspense.id)).toBeNull()
    expect(queryByTestId(UseQuerySuspense.id)).toBeNull()

    await cleanupAfterUnmount(() => {})
  })

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

    expect(result()).toBeUndefined()

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
