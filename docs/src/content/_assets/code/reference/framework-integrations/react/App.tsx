import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { type ReactNode, Suspense, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { ErrorBoundary } from 'react-error-boundary'

const appErrorFallback = <div>Something went wrong</div>
const appLoadingFallback = <div>Loading LiveStore...</div>

export const App = ({ children }: { children: ReactNode }) => {
  const [storeRegistry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))

  return (
    <ErrorBoundary fallback={appErrorFallback}>
      <Suspense fallback={appLoadingFallback}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>{children}</StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
