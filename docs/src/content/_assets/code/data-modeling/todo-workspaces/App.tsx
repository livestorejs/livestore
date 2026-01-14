import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { type ReactNode, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

export function App({ children }: { children: ReactNode }) {
  const [storeRegistry] = useState(
    () =>
      new StoreRegistry({
        defaultOptions: {
          batchUpdates,
        },
      }),
  )

  return <StoreRegistryProvider storeRegistry={storeRegistry}>{children}</StoreRegistryProvider>
}
