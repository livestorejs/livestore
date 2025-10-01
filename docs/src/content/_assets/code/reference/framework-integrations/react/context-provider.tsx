import type { Store } from '@livestore/livestore'
import { LiveStoreContext, type ReactApi } from '@livestore/react'
import type { FC, ReactNode } from 'react'

declare const store: Store & ReactApi

export const Root: FC<{ children: ReactNode }> = ({ children }) => (
  <LiveStoreContext.Provider value={{ stage: 'running', store }}>{children}</LiveStoreContext.Provider>
)
