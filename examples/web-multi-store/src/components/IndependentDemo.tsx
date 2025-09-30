import { Suspense } from 'react'
import { IssueStoreProvider } from '../stores/issue/context.ts'
import { WorkspaceStoreProvider } from '../stores/workspace/context.ts'
import { IssueView } from './IssueView.tsx'
import { WorkspaceView } from './WorkspaceView.tsx'

export function IndependentDemo() {
  return (
    <div>
      <h2>Independent</h2>
      <em>Independent · Different Types · Separate Loading</em>
      <p>
        Demonstrates unrelated store types loading side by side. Each provider owns its Suspense boundary so loading and
        failure states stay isolated.
      </p>

      <div className="grid">
        <Suspense fallback={<div className="loading">Loading workspace...</div>}>
          <WorkspaceStoreProvider>
            <WorkspaceView />
          </WorkspaceStoreProvider>
        </Suspense>

        <Suspense fallback={<div className="loading">Loading issue...</div>}>
          <IssueStoreProvider>
            <IssueView />
          </IssueStoreProvider>
        </Suspense>
      </div>
    </div>
  )
}
