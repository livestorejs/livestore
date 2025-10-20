import { MultiStoreProvider } from '@livestore/react'
import { useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { ErrorBoundary } from 'react-error-boundary'
import { ChainedDemo } from './components/ChainedDemo.tsx'
import { IndependentDemo } from './components/IndependentDemo.tsx'
import { MultiInstanceDemo } from './components/MultiInstanceDemo.tsx'
import { RecursiveDemo } from './components/RecursiveDemo.tsx'

type DemoTab = 'independent' | 'multiInstance' | 'chained' | 'recursive'

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div className="error">
      <h3>Something went wrong:</h3>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  )
}

export function App() {
  const [activeTab, setActiveTab] = useState<DemoTab>('independent')

  return (
    <div>
      <h1>LiveStore Multi-Store App</h1>
      <p>
        This app demonstrates the <code>createStoreContext</code> API for managing multiple LiveStore instances in a
        React application.
      </p>

      <div className="tabs">
        <div
          className={`tab ${activeTab === 'independent' ? 'active' : ''}`}
          onClick={() => setActiveTab('independent')}
        >
          Independent
        </div>
        <div
          className={`tab ${activeTab === 'multiInstance' ? 'active' : ''}`}
          onClick={() => setActiveTab('multiInstance')}
        >
          Multi-Instance
        </div>
        <div className={`tab ${activeTab === 'chained' ? 'active' : ''}`} onClick={() => setActiveTab('chained')}>
          Chained
        </div>
        <div className={`tab ${activeTab === 'recursive' ? 'active' : ''}`} onClick={() => setActiveTab('recursive')}>
          Recursive
        </div>
      </div>

      <ErrorBoundary FallbackComponent={ErrorFallback} resetKeys={[activeTab]}>
        <MultiStoreProvider
          defaultStoreOptions={{
            batchUpdates,
          }}
        >
          {activeTab === 'independent' && <IndependentDemo />}
          {activeTab === 'multiInstance' && <MultiInstanceDemo />}
          {activeTab === 'chained' && <ChainedDemo />}
          {activeTab === 'recursive' && <RecursiveDemo />}
        </MultiStoreProvider>
      </ErrorBoundary>

      <div className="container" style={{ marginTop: 40 }}>
        <h3>About this demo</h3>
        <ul>
          <li>
            <strong>Independent:</strong> Unrelated store types run in parallel with their own Suspense boundaries.
          </li>
          <li>
            <strong>Multi-Instance:</strong> Several instances of the same store type share a boundary while staying
            keyed by unique `storeId`s.
          </li>
          <li>
            <strong>Chained:</strong> Parent→child store composition (Workspace → Issue) with independent loading for
            each layer.
          </li>
          <li>
            <strong>Recursive:</strong> Same-type nesting (Issue → Sub-Issue) that demonstrates recursive store trees.
          </li>
        </ul>
        <p>Each store uses in-memory storage for quick testing. Open DevTools to see store instances and their data.</p>
      </div>
    </div>
  )
}
