import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import { useParams, useRouter } from '@tanstack/react-router'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { VersionBadge } from '../components/VersionBadge.tsx'
import { schema } from '../livestore/schema/index.ts'
import { renderBootStatus } from '../livestore/utils.tsx'
import LiveStoreWorker from '../livestore/worker.ts?worker'
import type { Status } from '../types/status.ts'
import { MenuContext, NewIssueModalContext } from './contexts.ts'

const hasWindow = typeof window !== 'undefined'
const resetPersistence =
  hasWindow && import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence && hasWindow) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makePersistedAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
  // NOTE this should only be used for convenience when developing (i.e. via `?reset` in the URL) and is disabled in production
  resetPersistence,
})

const defaultStoreId = 'linearlite-demo' as const
const syncPayload = { authToken: 'insecure-token-change-me' } as const

export const Provider = ({ children, storeId: storeIdOverride }: { children: React.ReactNode; storeId?: string }) => {
  const router = useRouter()
  const { storeId: routeStoreId } = useParams({ from: '/$storeId', strict: false }) ?? {}
  const storeId = storeIdOverride ?? import.meta.env.VITE_LIVESTORE_STORE_ID ?? defaultStoreId
  const [showMenu, setShowMenu] = React.useState(false)
  const [newIssueModalStatus, setNewIssueModalStatus] = React.useState<Status | false>(false)

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement
      if (element.classList.contains('input')) return
      if (e.key === 'c') {
        if (!element.classList.contains('input')) {
          setNewIssueModalStatus(0)
          e.preventDefault()
        }
      }
      if (e.key === '/' && e.shiftKey) {
        const currentStoreId = routeStoreId ?? storeId
        router.navigate({ to: '/$storeId/search', params: { storeId: currentStoreId } })
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [router, routeStoreId, storeId])

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      renderLoading={renderBootStatus}
      batchUpdates={batchUpdates}
      storeId={storeId}
      syncPayload={syncPayload}
    >
      <MenuContext.Provider value={{ showMenu, setShowMenu }}>
        <NewIssueModalContext.Provider value={{ newIssueModalStatus, setNewIssueModalStatus }}>
          {children}
        </NewIssueModalContext.Provider>
      </MenuContext.Provider>
      <VersionBadge />
    </LiveStoreProvider>
  )
}
