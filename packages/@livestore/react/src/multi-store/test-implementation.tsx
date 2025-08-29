// Test file to verify the createStoreContext implementation works

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { Schema } from '@livestore/utils/effect'
import { Suspense } from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { createStoreContext } from './createStoreContext.js'

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

const [MinimalProvider, useMinimalStore] = createStoreContext({
  name: 'minimal',
  schema: todoSchema,
})

function TestMinimal() {
  return (
    <MinimalProvider storeId="test-minimal" adapter={makeInMemoryAdapter()} batchUpdates={unstable_batchedUpdates}>
      <Suspense fallback={<div>Loading...</div>}>
        <MinimalContent />
      </Suspense>
    </MinimalProvider>
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

const [FullProvider, useFullStore] = createStoreContext({
  name: 'full',
  schema: todoSchema,
  adapter: makeInMemoryAdapter(),
  batchUpdates: unstable_batchedUpdates,
  storeId: 'full-default',
})

function TestFull() {
  return (
    <FullProvider>
      <Suspense fallback={<div>Loading...</div>}>
        <FullContent />
      </Suspense>
    </FullProvider>
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

const [MultiProvider, useMultiStore] = createStoreContext({
  name: 'multi',
  schema: todoSchema,
  adapter: makeInMemoryAdapter(),
  batchUpdates: unstable_batchedUpdates,
})

function TestMultiInstance() {
  return (
    <>
      <MultiProvider storeId="instance-1">
        <Suspense fallback={<div>Loading instance 1...</div>}>
          <InstanceContent instanceId="instance-1" />
        </Suspense>
      </MultiProvider>

      <MultiProvider storeId="instance-2">
        <Suspense fallback={<div>Loading instance 2...</div>}>
          <InstanceContent instanceId="instance-2" />
        </Suspense>
      </MultiProvider>
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

const [ParentProvider, useParentStore] = createStoreContext({
  name: 'parent',
  schema: todoSchema,
  adapter: makeInMemoryAdapter(),
  batchUpdates: unstable_batchedUpdates,
  storeId: 'parent-store',
})

const [ChildProvider, useChildStore] = createStoreContext({
  name: 'child',
  schema: todoSchema,
  adapter: makeInMemoryAdapter(),
  batchUpdates: unstable_batchedUpdates,
})

function TestNested() {
  return (
    <ParentProvider>
      <Suspense fallback={<div>Loading parent...</div>}>
        <ParentContent />
      </Suspense>
    </ParentProvider>
  )
}

function ParentContent() {
  const parentStore = useParentStore()
  console.log('Parent store loaded:', parentStore.storeId)

  return (
    <ChildProvider storeId={`child-of-${parentStore.storeId}`}>
      <Suspense fallback={<div>Loading child...</div>}>
        <ChildContent />
      </Suspense>
    </ChildProvider>
  )
}

function ChildContent() {
  const parentStore = useParentStore()
  const childStore = useChildStore()
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
