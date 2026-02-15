import type React from 'react'
import { Suspense, useState } from 'react'

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'

export const App: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <Suspense fallback={<div>Loading app...</div>}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <div className="todoapp">{/* Your app components go here */}</div>
      </StoreRegistryProvider>
    </Suspense>
  )
}
