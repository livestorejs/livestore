import { Suspense } from 'react'
import { IssueStoreProvider } from '../stores/issue/index.ts'
import { IssueView } from './IssueView.tsx'

export function RecursiveDemo() {
  return (
    <div>
      <h2>Recursive</h2>
      <em>Dependent · Same Type · Shared Loading</em>
      <p>
        Demonstrates a store tree where each level reuses the same context (Issue → Sub-Issue). All instances share a
        Suspense boundary while remaining individually addressable by `storeId`.
      </p>

      <div className="grid">
        <Suspense fallback={<div className="loading">Loading all issue stores...</div>}>
          <IssueStoreProvider issueId="root-issue">
            <IssueView />
          </IssueStoreProvider>
        </Suspense>
      </div>
    </div>
  )
}
