import { Suspense } from 'react'
import { WorkspaceView } from './WorkspaceView.tsx'

export function ChainedDemo() {
  return (
    <div>
      <h2>Chained</h2>
      <em>Dependent · Different Types · Separate Loading</em>
      <p>
        Demonstrates parent→child store composition (Workspace → Issue). The inner store waits on data from the outer
        provider but still suspends independently to keep loading isolated.
      </p>

      <div className="grid">
        <Suspense fallback={<div className="loading">Loading workspace store...</div>}>
          <WorkspaceView />
        </Suspense>
      </div>
    </div>
  )
}
