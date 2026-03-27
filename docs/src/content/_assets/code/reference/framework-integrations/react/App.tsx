import { type ReactNode, Suspense, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'

const appLoadingFallback = <div>Loading LiveStore...</div>

export const App = ({ children }: { children: ReactNode }) => {
  const [storeRegistry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))

  return (
    <Suspense fallback={appLoadingFallback}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>{children}</StoreRegistryProvider>
    </Suspense>
  )
}
