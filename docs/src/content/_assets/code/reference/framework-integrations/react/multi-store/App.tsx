import { StoreRegistry, StoreRegistryProvider } from '@livestore/react/experimental'
import { type ReactNode, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

export function App({ children }: { children: ReactNode }) {
  const [storeRegistry] = useState(
    () =>
      new StoreRegistry({
        defaultOptions: {
          // These options apply to all stores unless overridden
          batchUpdates,
          // gcTime: 60_000, // Optional: default garbage collection time
        },
      }),
  )

  return <StoreRegistryProvider storeRegistry={storeRegistry}>{children}</StoreRegistryProvider>
}
