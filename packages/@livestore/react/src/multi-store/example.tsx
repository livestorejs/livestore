// Example usage of the multi-store API showing type safety
// This file demonstrates the type-safe API but is not meant to be imported

import type { Adapter } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import React from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { createStoreContext } from './types.js'

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
const minimalContext = createStoreContext({
  name: 'minimal',
  schema: workspaceSchema,
})
const MinimalProvider = minimalContext[0]
const useMinimalStore = minimalContext[1]

// TypeScript enforces required props
function _MinimalExample() {
  return (
    <MinimalProvider
      storeId="workspace-1" // ✅ Required - TS error if missing (not provided in config)
      adapter={workspaceAdapter} // ✅ Required - TS error if missing
      batchUpdates={unstable_batchedUpdates} // ✅ Required - TS error if missing
    >
      <MinimalContent />
    </MinimalProvider>
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
const fullContext = createStoreContext({
  name: 'full',
  schema: projectSchema,
  adapter: projectAdapter,
  batchUpdates: unstable_batchedUpdates,
  storeId: 'main-project',
  disableDevtools: false,
})
const FullProvider = fullContext[0]
const useFullStore = fullContext[1]

// Only children required
function _FullExample() {
  return (
    <FullProvider>
      {' '}
      {/* // ✅ Valid - all requirements satisfied */}
      <FullContent />
    </FullProvider>
  )
}

// Can still override config values
function _FullWithOverrides() {
  return (
    <FullProvider
      storeId="other-project" // ✅ Optional override
      adapter={projectAdapter} // ✅ Optional override
      disableDevtools={true} // ✅ Optional override
    >
      <FullContent />
    </FullProvider>
  )
}

// ============================================
// Example 3: Partial Configuration (without storeId)
// ============================================
// Adapter provided, batchUpdates and storeId not provided
const partialContext = createStoreContext({
  name: 'partial',
  schema: issueSchema,
  adapter: issueAdapter, // Provided here
  // storeId not provided - will be required at Provider
})
const PartialProvider = partialContext[0]
const usePartialStore = partialContext[1]

// ============================================
// Example 3b: Partial Configuration (with storeId)
// ============================================
// Adapter and storeId provided, batchUpdates not provided
const partialWithIdContext = createStoreContext({
  name: 'partialWithId',
  schema: issueSchema,
  adapter: issueAdapter,
  storeId: 'default-issue', // Provided here
})
const PartialWithIdProvider = partialWithIdContext[0]
const _usePartialWithIdStore = partialWithIdContext[1]

// Both batchUpdates and storeId required (storeId not provided in config)
function _PartialExample() {
  return (
    <PartialProvider
      storeId="custom-issue" // ✅ Required - TS error if missing (not provided in config)
      batchUpdates={unstable_batchedUpdates} // ✅ Required
    >
      <PartialContent />
    </PartialProvider>
  )
}

// Only batchUpdates required (storeId provided in config)
function _PartialWithIdExample() {
  return (
    <PartialWithIdProvider
      batchUpdates={unstable_batchedUpdates} // ✅ Required
      // storeId is optional - defaults to 'default-issue' from config
    >
      <PartialContent />
    </PartialWithIdProvider>
  )
}

// Can still override the storeId from config
function _PartialWithIdOverrideExample() {
  return (
    <PartialWithIdProvider
      batchUpdates={unstable_batchedUpdates} // ✅ Required
      storeId="override-issue" // ✅ Optional - overrides config value
    >
      <PartialContent />
    </PartialWithIdProvider>
  )
}

// ============================================
// Example 4: Using the Stores
// ============================================
function MinimalContent() {
  const _store = useMinimalStore()
  // store is fully typed with workspaceSchema

  // Can also access specific instances
  const _specificStore = useMinimalStore({ storeId: 'workspace-123' })

  return <div>Workspace Store</div>
}

function FullContent() {
  const _store = useFullStore()
  // store is fully typed with projectSchema

  // Future: will have React-specific methods
  // const tasks = store.useQuery(tasksQuery)

  return <div>Project Store</div>
}

function PartialContent() {
  const _store = usePartialStore()
  // store is fully typed with issueSchema

  return <div>Issue Store</div>
}

// ============================================
// Example 5: Multiple Instances
// ============================================
function _MultipleIssues({ issueIds }: { issueIds: string[] }) {
  // Note: In practice, you'd wrap each component with its own provider
  // This is just demonstrating the pattern
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      {issueIds.map((id) => (
        <PartialProvider key={id} storeId={`issue-${id}`} batchUpdates={unstable_batchedUpdates}>
          <IssueView issueId={id} />
        </PartialProvider>
      ))}
    </React.Suspense>
  )
}

function IssueView({ issueId }: { issueId: string }) {
  // Access specific instance
  const _store = usePartialStore({ storeId: `issue-${issueId}` })

  return <div>Issue {issueId}</div>
}

// ============================================
// Example 6: Nested Stores
// ============================================
function _App() {
  return (
    // Workspace store with full config
    <FullProvider>
      <React.Suspense fallback={<div>Loading workspace...</div>}>
        <WorkspaceView />
      </React.Suspense>
    </FullProvider>
  )
}

function WorkspaceView() {
  const _workspaceStore = useFullStore()
  // Use workspace data to determine project ID
  const projectId = 'project-from-workspace'

  return (
    // Project store nested inside workspace
    <PartialProvider storeId={projectId} batchUpdates={unstable_batchedUpdates}>
      <React.Suspense fallback={<div>Loading project...</div>}>
        <ProjectView />
      </React.Suspense>
    </PartialProvider>
  )
}

function ProjectView() {
  const _projectStore = usePartialStore()

  return <div>Project content</div>
}

// This file demonstrates type-safe patterns but is not meant to be imported
