// Test file to verify the createStoreContext implementation works

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import { Suspense } from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { createStoreContext } from './createStoreContext.tsx'

// ============================================
// Create a test schema
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

const state = State.SQLite.makeState({ tables: { todos }, materializers: {} })
const todoSchema = makeSchema({ state, events })

// ============================================
// Test 1: Minimal configuration (all required at Provider)
// ============================================

const [MinimalStoreProvider, useMinimalStore] = createStoreContext({
  name: 'minimal',
  schema: todoSchema,
})

function TestMinimal() {
  return (
    <Suspense fallback={<div>Loading minimal store...</div>}>
      <MinimalStoreProvider adapter={makeInMemoryAdapter()} batchUpdates={unstable_batchedUpdates}>
        <MinimalContent />
      </MinimalStoreProvider>
    </Suspense>
  )
}

function MinimalContent() {
  const store = useMinimalStore()
  console.log('Minimal store loaded:', store.storeId)
  return <div>Store ID: {store.storeId}</div>
}

// ============================================
// Test 2: Full configuration (nothing required at Provider)
// ============================================

const [FullStoreProvider, useFullStore] = createStoreContext({
  name: 'full',
  schema: todoSchema,
  adapter: makeInMemoryAdapter(),
  batchUpdates: unstable_batchedUpdates,
})

function TestFull() {
  return (
    <Suspense fallback={<div>Loading full store...</div>}>
      <FullStoreProvider storeId="full-default">
        <FullContent />
      </FullStoreProvider>
    </Suspense>
  )
}

function FullContent() {
  const store = useFullStore()
  console.log('Full store loaded:', store.storeId)
  return <div>Store ID: {store.storeId}</div>
}

// ============================================
// Test 3: Multiple instances
// ============================================

const [MultiStoreProvider, useMultiStore] = createStoreContext({
  name: 'multi',
  schema: todoSchema,
  adapter: makeInMemoryAdapter(),
  batchUpdates: unstable_batchedUpdates,
})

function TestMultiInstance() {
  return (
    <>
      <Suspense fallback={<div>Loading instance 1...</div>}>
        <MultiStoreProvider storeId="instance-1">
          <InstanceContent instanceId="instance-1" />
        </MultiStoreProvider>
      </Suspense>

      <Suspense fallback={<div>Loading instance 2...</div>}>
        <MultiStoreProvider storeId="instance-2">
          <InstanceContent instanceId="instance-2" />
        </MultiStoreProvider>
      </Suspense>
    </>
  )
}

function InstanceContent({ instanceId }: { instanceId: string }) {
  // Access specific instance
  const store = useMultiStore({ storeId: instanceId })
  console.log(`Instance ${instanceId} loaded:`, store.storeId)
  return <div>Instance: {store.storeId}</div>
}

// ============================================
// Test 4: Nested stores
// ============================================

const [TodosStoreProvider, useTodosStore] = createStoreContext({
  name: 'todos',
  schema: todoSchema,
  adapter: makeInMemoryAdapter(),
  batchUpdates: unstable_batchedUpdates,
})

function TestNested() {
  return (
    <Suspense fallback={<div>Loading nested stores...</div>}>
      <TodosStoreProvider storeId="parent-store">
        <ParentContent />
      </TodosStoreProvider>
    </Suspense>
  )
}

function ParentContent() {
  const parentStore = useTodosStore({ storeId: 'parent-store' })
  console.log('Parent store loaded:', parentStore.storeId)

  return (
    <Suspense fallback={<div>Loading child store...</div>}>
      <TodosStoreProvider storeId={`child-of-${parentStore.storeId}`}>
        <ChildContent />
      </TodosStoreProvider>
    </Suspense>
  )
}

function ChildContent() {
  // When no `storeId` is provided, it should use the store instance of the closest todos store provider
  const parentStore = useTodosStore()
  const childStore = useTodosStore({ storeId: `child-of-${parentStore.storeId}` })
  console.log('Parent:', parentStore.storeId, 'Child:', childStore.storeId)

  return (
    <div>
      Parent: {parentStore.storeId}
      <br />
      Child: {childStore.storeId}
    </div>
  )
}

// ============================================
// Export test app
// ============================================

export function TestApp() {
  return (
    <div>
      <h2>Test 1: Minimal Configuration</h2>
      <TestMinimal />

      <h2>Test 2: Full Configuration</h2>
      <TestFull />

      <h2>Test 3: Multiple Instances</h2>
      <TestMultiInstance />

      <h2>Test 4: Nested Stores</h2>
      <TestNested />
    </div>
  )
}
