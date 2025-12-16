import { StoreRegistry, StoreRegistryProvider } from '@livestore/react'
import type { FC, ReactNode } from 'react'
import { Suspense, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

export const Root: FC<{ children: ReactNode }> = ({ children }) => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <Suspense fallback={<div>Loading LiveStore...</div>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>{children}</StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
