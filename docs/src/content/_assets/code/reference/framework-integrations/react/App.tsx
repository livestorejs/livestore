import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { type ReactNode, Suspense, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { ErrorBoundary } from 'react-error-boundary'

export function App({ children }: { children: ReactNode }) {
  const [storeRegistry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))

  return (
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <Suspense fallback={<div>Loading LiveStore...</div>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>{children}</StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
