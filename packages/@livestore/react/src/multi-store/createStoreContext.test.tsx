/** biome-ignore-all lint/a11y: test */
import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import * as ReactTesting from '@testing-library/react'
import React, { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { unstable_batchedUpdates } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { createStoreContext } from './createStoreContext.tsx'

// ============================================
// Test Schema Setup
// ============================================

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    title: State.SQLite.text({ nullable: false }),
    completed: State.SQLite.boolean({ default: false }),
  },
})

const events = {
  todoAdded: Events.synced({
    name: 'todoAdded',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
  todoToggled: Events.synced({
    name: 'todoToggled',
    schema: Schema.Struct({ id: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoAdded: ({ id, title }) => todos.insert({ id, title, completed: false }),
  todoToggled: ({ id }) => todos.update({ completed: false }).where({ id }),
})

const state = State.SQLite.makeState({ tables: { todos }, materializers })
const todoSchema = makeSchema({ state, events })

// ============================================
// Tests
// ============================================

describe.each([true, false])('createStoreContext (strictMode: %s)', (strictMode) => {
  const WithStrictMode = strictMode ? React.StrictMode : React.Fragment

  afterEach(() => {
    ReactTesting.cleanup()
  })

  it('minimal configuration - adapter and batchUpdates required at Provider', async () => {
    const [MinimalStoreProvider, useMinimalStore] = createStoreContext({
      name: 'minimal',
      schema: todoSchema,
    })

    let renderCount = 0

    const Content = () => {
      renderCount++
      const store = useMinimalStore()
      return <div>Store ID: {store.storeId}</div>
    }

    const App = () => (
      <WithStrictMode>
        <Suspense fallback={<div>Loading...</div>}>
          <MinimalStoreProvider adapter={makeInMemoryAdapter()} batchUpdates={unstable_batchedUpdates}>
            <Content />
          </MinimalStoreProvider>
        </Suspense>
      </WithStrictMode>
    )

    ReactTesting.render(<App />)

    // Should show loading initially
    expect(ReactTesting.screen.getByText('Loading...')).toBeDefined()

    // Wait for store to be ready
    await ReactTesting.waitFor(() => ReactTesting.screen.getByText(/Store ID:/))

    expect(renderCount).toBe(strictMode ? 2 : 1)
    expect(ReactTesting.screen.getByText('Store ID: minimal')).toBeDefined()
  })

  it('full configuration - nothing required at Provider', async () => {
    const [FullStoreProvider, useFullStore] = createStoreContext({
      name: 'full',
      schema: todoSchema,
      adapter: makeInMemoryAdapter(),
      batchUpdates: unstable_batchedUpdates,
    })

    let renderCount = 0

    const Content = () => {
      renderCount++
      const store = useFullStore()
      return <div>Store ID: {store.storeId}</div>
    }

    const App = () => (
      <WithStrictMode>
        <Suspense fallback={<div>Loading...</div>}>
          <FullStoreProvider>
            <Content />
          </FullStoreProvider>
        </Suspense>
      </WithStrictMode>
    )

    ReactTesting.render(<App />)

    await ReactTesting.waitFor(() => ReactTesting.screen.getByText('Store ID: full'))

    expect(renderCount).toBe(strictMode ? 2 : 1)
  })

  it('storeId override at Provider level', async () => {
    const [StoreProvider, useStore] = createStoreContext({
      name: 'default-name',
      schema: todoSchema,
      adapter: makeInMemoryAdapter(),
      batchUpdates: unstable_batchedUpdates,
    })

    const Content = () => {
      const store = useStore()
      return <div>Store ID: {store.storeId}</div>
    }

    const App = () => (
      <WithStrictMode>
        <Suspense fallback={<div>Loading...</div>}>
          <StoreProvider storeId="custom-id">
            <Content />
          </StoreProvider>
        </Suspense>
      </WithStrictMode>
    )

    ReactTesting.render(<App />)

    await ReactTesting.waitFor(() => ReactTesting.screen.getByText('Store ID: custom-id'))
  })

  it('multiple instances with different storeIds', async () => {
    const [MultiStoreProvider, useMultiStore] = createStoreContext({
      name: 'multi',
      schema: todoSchema,
      adapter: makeInMemoryAdapter(),
      batchUpdates: unstable_batchedUpdates,
    })

    const renderCounts = { instance1: 0, instance2: 0 }

    const InstanceContent = ({ instanceId }: { instanceId: string }) => {
      renderCounts[instanceId as keyof typeof renderCounts]++
      const store = useMultiStore({ storeId: instanceId })
      return <div role="content">{store.storeId}</div>
    }

    const App = () => (
      <WithStrictMode>
        <Suspense fallback={<div>Loading instance 1...</div>}>
          <MultiStoreProvider storeId="instance1">
            <InstanceContent instanceId="instance1" />
          </MultiStoreProvider>
        </Suspense>

        <Suspense fallback={<div>Loading instance 2...</div>}>
          <MultiStoreProvider storeId="instance2">
            <InstanceContent instanceId="instance2" />
          </MultiStoreProvider>
        </Suspense>
      </WithStrictMode>
    )

    ReactTesting.render(<App />)

    await ReactTesting.waitFor(() => {
      const contents = ReactTesting.screen.getAllByRole('content')
      expect(contents).toHaveLength(2)
    })

    expect(renderCounts.instance1).toBe(strictMode ? 2 : 1)
    expect(renderCounts.instance2).toBe(strictMode ? 2 : 1)

    const contents = ReactTesting.screen.getAllByRole('content')
    expect(contents[0]?.textContent).toBe('instance1')
    expect(contents[1]?.textContent).toBe('instance2')
  })

  it('nested stores with different contexts', async () => {
    const [TodosStoreProvider, useTodosStore] = createStoreContext({
      name: 'todos',
      schema: todoSchema,
      adapter: makeInMemoryAdapter(),
      batchUpdates: unstable_batchedUpdates,
    })

    const ChildContent = () => {
      // Should use the closest provider (child)
      const store = useTodosStore()
      return <div role="child">Child: {store.storeId}</div>
    }

    const ParentContent = () => {
      const parentStore = useTodosStore({ storeId: 'parent-store' })

      return (
        <>
          <div role="parent">Parent: {parentStore.storeId}</div>
          <Suspense fallback={<div>Loading child...</div>}>
            <TodosStoreProvider storeId={`child-of-${parentStore.storeId}`}>
              <ChildContent />
            </TodosStoreProvider>
          </Suspense>
        </>
      )
    }

    const App = () => (
      <WithStrictMode>
        <Suspense fallback={<div>Loading parent...</div>}>
          <TodosStoreProvider storeId="parent-store">
            <ParentContent />
          </TodosStoreProvider>
        </Suspense>
      </WithStrictMode>
    )

    ReactTesting.render(<App />)

    await ReactTesting.waitFor(() => {
      expect(ReactTesting.screen.getByRole('parent')).toBeDefined()
      expect(ReactTesting.screen.getByRole('child')).toBeDefined()
    })

    expect(ReactTesting.screen.getByRole('parent').textContent).toBe('Parent: parent-store')
    expect(ReactTesting.screen.getByRole('child').textContent).toBe('Child: child-of-parent-store')
  })

  it('throws error when accessing non-existent storeId', async () => {
    const [StoreProvider, useStore] = createStoreContext({
      name: 'test',
      schema: todoSchema,
      adapter: makeInMemoryAdapter(),
      batchUpdates: unstable_batchedUpdates,
    })

    const Content = () => {
      // Try to access a non-existent store
      useStore({ storeId: 'non-existent' })
      return <div>Should not render</div>
    }

    const ErrorFallback = ({ error }: { error: Error }) => (
      <div role="error">{error.message}</div>
    )

    const App = () => (
      <WithStrictMode>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<div>Loading...</div>}>
            <StoreProvider storeId="existing-store">
              <Content />
            </StoreProvider>
          </Suspense>
        </ErrorBoundary>
      </WithStrictMode>
    )

    ReactTesting.render(<App />)

    // Should catch error and display it
    await ReactTesting.waitFor(() => {
      expect(ReactTesting.screen.getByRole('error')).toBeDefined()
    })

    expect(ReactTesting.screen.getByRole('error').textContent).toMatch(/Store instance "non-existent" not found/)
  })

  it('throws error when useStore called outside Provider', async () => {
    const [_StoreProvider, useStore] = createStoreContext({
      name: 'test',
      schema: todoSchema,
    })

    const Content = () => {
      useStore()
      return <div>Should not render</div>
    }

    const ErrorFallback = ({ error }: { error: Error }) => (
      <div role="error">{error.message}</div>
    )

    const App = () => (
      <WithStrictMode>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Content />
        </ErrorBoundary>
      </WithStrictMode>
    )

    ReactTesting.render(<App />)

    // Should catch error and display it
    await ReactTesting.waitFor(() => {
      expect(ReactTesting.screen.getByRole('error')).toBeDefined()
    })

    expect(ReactTesting.screen.getByRole('error').textContent).toMatch(/must be used within a test Provider/)
  })

  it('provider reuses parent registry when nested', async () => {
    const [StoreProvider, useStore] = createStoreContext({
      name: 'shared',
      schema: todoSchema,
      adapter: makeInMemoryAdapter(),
      batchUpdates: unstable_batchedUpdates,
    })

    const InnerContent = () => {
      // Access store from outer provider
      const outerStore = useStore({ storeId: 'outer' })
      // Access store from inner provider
      const innerStore = useStore({ storeId: 'inner' })
      return (
        <div>
          <div role="outer">Outer: {outerStore.storeId}</div>
          <div role="inner">Inner: {innerStore.storeId}</div>
        </div>
      )
    }

    const App = () => (
      <WithStrictMode>
        <Suspense fallback={<div>Loading outer...</div>}>
          <StoreProvider storeId="outer">
            <Suspense fallback={<div>Loading inner...</div>}>
              <StoreProvider storeId="inner">
                <InnerContent />
              </StoreProvider>
            </Suspense>
          </StoreProvider>
        </Suspense>
      </WithStrictMode>
    )

    ReactTesting.render(<App />)

    await ReactTesting.waitFor(() => {
      expect(ReactTesting.screen.getByRole('outer')).toBeDefined()
      expect(ReactTesting.screen.getByRole('inner')).toBeDefined()
    })

    expect(ReactTesting.screen.getByRole('outer').textContent).toBe('Outer: outer')
    expect(ReactTesting.screen.getByRole('inner').textContent).toBe('Inner: inner')
  })

  it('suspense handles store switching correctly', async () => {
    const [StoreProvider, useStore] = createStoreContext({
      name: 'switchable',
      schema: todoSchema,
      adapter: makeInMemoryAdapter(),
      batchUpdates: unstable_batchedUpdates,
    })

    const Content = () => {
      const store = useStore()
      return <div role="content">Store: {store.storeId}</div>
    }

    const App = ({ storeId }: { storeId: string }) => (
      <WithStrictMode>
        <Suspense fallback={<div>Loading {storeId}...</div>}>
          <StoreProvider storeId={storeId}>
            <Content />
          </StoreProvider>
        </Suspense>
      </WithStrictMode>
    )

    const { rerender } = ReactTesting.render(<App storeId="store1" />)

    await ReactTesting.waitFor(() => ReactTesting.screen.getByRole('content'))
    expect(ReactTesting.screen.getByRole('content').textContent).toBe('Store: store1')

    // Switch to different store
    rerender(<App storeId="store2" />)

    // Should show loading while switching
    await ReactTesting.waitFor(() => ReactTesting.screen.getByText('Loading store2...'))

    // Should eventually show new store
    await ReactTesting.waitFor(() => ReactTesting.screen.getByRole('content'))
    expect(ReactTesting.screen.getByRole('content').textContent).toBe('Store: store2')
  })
})