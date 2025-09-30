// Example usage of the multi-store API showing type safety
// This file demonstrates the type-safe API but is not meant to be imported

/** biome-ignore-all lint/correctness/noUnusedVariables: we want to show unused variables as part of the example */
import type { Adapter } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { Suspense } from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { createStoreContext } from './createStoreContext.tsx'

// Mock schemas for demonstration (actual schemas would be created with makeSchema)
// These are just for showing the type-safe API, not actual implementations
declare const workspaceSchema: LiveStoreSchema
declare const projectSchema: LiveStoreSchema
declare const issueSchema: LiveStoreSchema

// Example adapters
const workspaceAdapter: Adapter = {} as any
const projectAdapter: Adapter = {} as any
const issueAdapter: Adapter = {} as any

// ============================================
// Example 1: Minimal Configuration
// ============================================
// Only schema and name provided - adapter and batchUpdates required at Provider
const [MinimalStoreProvider, useMinimalStore] = createStoreContext({
  name: 'minimal',
  schema: workspaceSchema,
})

// TypeScript enforces required props
function MinimalExample() {
  return (
    <Suspense fallback={<div>Loading minimal store...</div>}>
      <MinimalStoreProvider
        // storeId defaults to the store name ('minimal') but can be overridden
        adapter={workspaceAdapter} // ✅ Required - TS error if missing
        batchUpdates={unstable_batchedUpdates} // ✅ Required - TS error if missing
      >
        <MinimalContent />
      </MinimalStoreProvider>
    </Suspense>
  )
}

// This would cause a TypeScript error:
// function InvalidMinimal() {
//   return (
//     <MinimalProvider>  // ❌ TS Error: Missing required props
//       <div />
//     </MinimalProvider>
//   )
// }

// ============================================
// Example 2: Full Configuration
// ============================================
// Everything provided upfront - nothing required at Provider
const [FullStoreProvider, useFullStore] = createStoreContext({
  name: 'full',
  schema: projectSchema,
  adapter: projectAdapter,
  batchUpdates: unstable_batchedUpdates,
  disableDevtools: false,
})

// Only children required
function FullExample() {
  return (
    <Suspense fallback={<div>Loading full store...</div>}>
      <FullStoreProvider>
        {/* // ✅ Valid - all requirements satisfied */}
        <FullContent />
      </FullStoreProvider>
    </Suspense>
  )
}

// Can still override config values
function FullWithOverrides() {
  return (
    <Suspense fallback={<div>Loading overridden project store...</div>}>
      <FullStoreProvider
        storeId="other-project" // ✅ Optional override (defaults to store name 'full')
        adapter={projectAdapter} // ✅ Optional override
        disableDevtools={true} // ✅ Optional override
      >
        <FullContent />
      </FullStoreProvider>
    </Suspense>
  )
}

// ============================================
// Example 3: Partial Configuration
// ============================================
// Adapter provided and batchUpdates not provided
const [PartialStoreProvider, usePartialStore] = createStoreContext({
  name: 'partial',
  schema: issueSchema,
  adapter: issueAdapter, // Provided here
})

// Only batchUpdates required
function PartialExample() {
  return (
    <Suspense fallback={<div>Loading partial store...</div>}>
      <PartialStoreProvider batchUpdates={unstable_batchedUpdates}>
        <PartialContent />
      </PartialStoreProvider>
    </Suspense>
  )
}

// StoreId can be passed to have distinct store instances
function PartialOverrideExample() {
  return (
    <Suspense fallback={<div>Loading issue store custom-issue...</div>}>
      <PartialStoreProvider storeId="custom-issue" batchUpdates={unstable_batchedUpdates}>
        <PartialContent />
      </PartialStoreProvider>
    </Suspense>
  )
}

// ============================================
// Example 4: Using the Stores
// ============================================
function MinimalContent() {
  // store is fully typed with workspaceSchema
  const store = useMinimalStore()

  return <div>Workspace Store</div>
}

function FullContent() {
  // store is fully typed with projectSchema
  const store = useFullStore()

  // Can also access specific instances
  const specificStore = useFullStore({ storeId: 'other-project' })

  // Future: will have React-specific methods
  // const tasks = store.useQuery(tasksQuery)

  return <div>Project Store</div>
}

function PartialContent() {
  // store is fully typed with issueSchema
  const store = usePartialStore()

  return <div>Issue Store</div>
}

// ============================================
// Example 5: Multiple Instances
// ============================================
function MultipleIssues({ issueIds }: { issueIds: string[] }) {
  // Note: In practice, you'd wrap each component with its own provider
  // This is just demonstrating the pattern
  return (
    <Suspense fallback={<div>Loading issues...</div>}>
      {issueIds.map((id) => (
        <PartialStoreProvider key={id} storeId={`issue-${id}`} batchUpdates={unstable_batchedUpdates}>
          <IssueView issueId={id} />
        </PartialStoreProvider>
      ))}
    </Suspense>
  )
}

function IssueView({ issueId }: { issueId: string }) {
  // Access specific instance
  const store = usePartialStore({ storeId: `issue-${issueId}` })

  return <div>Issue {issueId}</div>
}

// ============================================
// Example 6: Nested Stores
// ============================================
function App() {
  return (
    // Workspace store with full config
    <Suspense fallback={<div>Loading workspace store...</div>}>
      <FullStoreProvider>
        <WorkspaceView />
      </FullStoreProvider>
    </Suspense>
  )
}

function WorkspaceView() {
  const workspaceStore = useFullStore()
  // Use workspace data to determine project ID
  const projectId = 'project-from-workspace'

  return (
    // Project store nested inside workspace
    <Suspense fallback={<div>Loading project store...</div>}>
      <PartialStoreProvider storeId={projectId} batchUpdates={unstable_batchedUpdates}>
        <ProjectView />
      </PartialStoreProvider>
    </Suspense>
  )
}

function ProjectView() {
  const projectStore = usePartialStore()

  return <div>Project content</div>
}

// This file demonstrates type-safe patterns but is not meant to be imported
