import { LiveStoreProvider } from '@livestore/react'
import type { ReactNode } from 'react'

const schema = {} as Parameters<typeof LiveStoreProvider>[0]['schema']
const storeId = 'demo-store'
const user = { jwt: 'user-token' }
const children: ReactNode = null

// ---cut---
export const AuthenticatedProvider = () => (
  <LiveStoreProvider
    schema={schema}
    storeId={storeId}
    syncPayload={{
      authToken: user.jwt, // Using a JWT
    }}
  >
    {/* ... */}
    {children}
  </LiveStoreProvider>
)
