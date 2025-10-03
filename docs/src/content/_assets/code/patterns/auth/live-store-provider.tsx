import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { LiveStoreProvider } from '@livestore/react'
import type { ReactNode } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

const schema = {} as Parameters<typeof LiveStoreProvider>[0]['schema']
const storeId = 'demo-store'
const user = { jwt: 'user-token' }
const children: ReactNode = null
const adapter = makeInMemoryAdapter()

// ---cut---
export const AuthenticatedProvider = () => (
  <LiveStoreProvider
    schema={schema}
    storeId={storeId}
    adapter={adapter}
    batchUpdates={batchUpdates}
    syncPayload={{
      authToken: user.jwt, // Using a JWT
    }}
  >
    {/* ... */}
    {children}
  </LiveStoreProvider>
)
