import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import type React from 'react'
import { Suspense, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { TodoList } from './components/TodoList.tsx'
import { useAppStore } from './livestore/store.ts'

const AppBody: React.FC = () => {
  const store = useAppStore()

  return (
    <main className="app-shell">
      <header>
        <h1>Multi State Example</h1>
        <p>
          One store instance (<code>{store.storeId}</code>) with two SQLite state backends.
        </p>
      </header>

      <section className="lists-grid">
        <TodoList backend="a" title="Todo List A (default backend)" store={store} />
        <TodoList backend="b" title="Todo List B" store={store} />
      </section>
    </main>
  )
}

export const App: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <Suspense fallback={<div>Loading app...</div>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <AppBody />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
