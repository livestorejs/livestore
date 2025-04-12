import type { LiveStoreContextRunning } from '@livestore/livestore'
import React from 'react'

import type { useClientDocument } from './useClientDocument.js'
import type { useQuery } from './useQuery.js'

export type ReactApi = {
  useQuery: typeof useQuery
  useClientDocument: typeof useClientDocument
}

export const LiveStoreContext = React.createContext<
  { stage: 'running'; store: LiveStoreContextRunning['store'] & ReactApi } | undefined
>(undefined)
