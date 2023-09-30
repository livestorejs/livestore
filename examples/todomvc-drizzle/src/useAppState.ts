import { useGlobalQuery, useStore } from '@livestore/livestore/react'

import type { AppState } from './schema.js'

export const useAppState = (): Readonly<AppState> => {
  const { globalQueries } = useStore()
  return useGlobalQuery(globalQueries.appState!) as any
}
