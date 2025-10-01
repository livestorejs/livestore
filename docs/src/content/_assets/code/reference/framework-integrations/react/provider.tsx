import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { LiveStoreProvider } from '@livestore/react'
import type { FC, ReactNode } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { schema } from './schema.ts'

const adapter = makeInMemoryAdapter()

export const Root: FC<{ children: ReactNode }> = ({ children }) => (
  <LiveStoreProvider schema={schema} adapter={adapter} batchUpdates={batchUpdates}>
    {children}
  </LiveStoreProvider>
)
