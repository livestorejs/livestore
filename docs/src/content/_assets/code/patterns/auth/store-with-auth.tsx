import { Suspense, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { type LiveStoreSchema, StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider, useStore } from '@livestore/react'

const schema = {} as LiveStoreSchema
const storeId = 'demo-store'
const user = { jwt: 'user-token' }
const adapter = makeInMemoryAdapter()

// ---cut---
const useAppStore = () =>
  useStore({
    storeId,
    schema,
    adapter,
    batchUpdates,
    syncPayload: {
      authToken: user.jwt, // Using a JWT
    },
  })

export const App = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <AppContent />
      </StoreRegistryProvider>
    </Suspense>
  )
}

const AppContent = () => {
  const _store = useAppStore()
  // Use the store in your components
  return <div>{/* Your app content */}</div>
}
