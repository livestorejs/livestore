import { Suspense } from 'react'
import { IssueStoreProvider } from '../stores/issue/context.ts'
import { IssueView } from './IssueView.tsx'

const issueIds = ['issue-1', 'issue-2', 'issue-3']

export function MultiInstanceDemo() {
  return (
    <div>
      <h2>Multi-Instance</h2>
      <em>Independent · Same Type · Shared Loading</em>
      <p>
        Demonstrates multiple instances of a single store type sharing one Suspense boundary. Each issue still owns an
        isolated store instance keyed by its `storeId`.
      </p>

      <div className="grid">
        <Suspense fallback={<div className="loading">Loading all issue stores...</div>}>
          {issueIds.map((issueId) => (
            <IssueStoreProvider key={issueId} storeId={issueId}>
              <IssueView />
            </IssueStoreProvider>
          ))}
        </Suspense>
      </div>
    </div>
  )
}
