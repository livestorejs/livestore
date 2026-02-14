import type { FC } from 'react'
import { Suspense, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider, useStore } from '@livestore/react'

import { tracer } from './otel.ts'
import { schema } from './schema.ts'

const adapter = makeInMemoryAdapter()

// ---cut---
const useAppStore = () =>
  useStore({
    storeId: 'otel-demo',
    schema,
    adapter,
    batchUpdates,
    otelOptions: { tracer },
  })

export const App: FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <AppContent />
      </StoreRegistryProvider>
    </Suspense>
  )
}

const AppContent: FC = () => {
  const _store = useAppStore()
  // Use the store in your components
  return <div>{/* Your app content */}</div>
}
