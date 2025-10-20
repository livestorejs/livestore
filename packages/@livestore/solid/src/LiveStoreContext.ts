import type { LiveStoreContextRunning } from '@livestore/livestore'

import type { useClientDocument } from './useClientDocument.ts'
import type { useQuery } from './useQuery.ts'
import { createContext } from 'solid-js'

export type SolidApi = {
  useQuery: typeof useQuery
  useClientDocument: typeof useClientDocument
}

export const LiveStoreContext = createContext<
  { stage: 'running'; store: LiveStoreContextRunning['store'] & SolidApi } | undefined
>(undefined)
