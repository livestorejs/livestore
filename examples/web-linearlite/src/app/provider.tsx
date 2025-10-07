import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { MenuContext, NewIssueModalContext } from '@/app/contexts'
import { VersionBadge } from '@/components/VersionBadge'
import { schema } from '@/lib/livestore/schema'
import { renderBootStatus } from '@/lib/livestore/utils'
import LiveStoreWorker from '@/lib/livestore/worker?worker'
import type { Status } from '@/types/status'

const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence) {
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

export const Provider = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate()
  const { storeId: routeStoreId } = useParams()
  const storeId = (routeStoreId as string | undefined) ?? (import.meta.env.VITE_LIVESTORE_STORE_ID as string | undefined)
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
        navigate('search')
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      renderLoading={renderBootStatus}
      batchUpdates={batchUpdates}
      storeId={storeId}
      syncPayload={{ authToken: 'insecure-token-change-me' }}
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
