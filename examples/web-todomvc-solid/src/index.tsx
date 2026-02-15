import 'todomvc-app-css/index.css'

import { StoreRegistry, StoreRegistryProvider } from '@livestore/solid'
import { ErrorBoundary, Suspense } from 'solid-js'
import { render } from 'solid-js/web'

import App from './App.tsx'

const errorBoundaryFallback = <div>Something went wrong</div>
const suspenseFallback = <div>Loading app...</div>

const root = document.getElementById('root')

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
  )
}

const storeRegistry = new StoreRegistry()

render(
  () => (
    <ErrorBoundary fallback={errorBoundaryFallback}>
      <Suspense fallback={suspenseFallback}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <App />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  ),
  root!,
)
