import { useQuery, useStore } from '@livestore/react'
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router'
import React, { useEffect } from 'react'

import { uiState$ } from '@/livestore/queries.ts'
import { events } from '@/livestore/schema.ts'

export const NavigationHistoryTracker = () => {
  const pathname = usePathname()
  const globalParams = useGlobalSearchParams()
  const { store } = useStore()
  const { navigationHistory } = useQuery(uiState$)
  const router = useRouter()

  const constructPathWithParams = React.useCallback((path: string, params: any) => {
    if (Object.keys(params).length > 0) {
      return `${path}?${Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&')}`
    }
    return path
  }, [])

  // Update navigation history on path change
  useEffect(() => {
    if (!pathname) return

    // ignore root path only for the initial mount
    if (pathname === '/' && navigationHistory === '/') return

    if (navigationHistory !== pathname) {
      store.commit(events.uiStateSet({ navigationHistory: constructPathWithParams(pathname, globalParams) }))
    }
  }, [constructPathWithParams, globalParams, navigationHistory, pathname, store])

  // Restore navigation on mount
  useEffect(() => {
    if (!navigationHistory) return
    if (navigationHistory === '/') return
    if (pathname === navigationHistory) return

    const path = constructPathWithParams(navigationHistory, globalParams)

    // Use replace to avoid adding to history stack
    console.log('📜 Restoring navigation', path)
    // timeout to allow router to mount
    setTimeout(() => {
      router.push(path as any)
    }, 100)
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array ensures this only runs once on mount

  return null
}
