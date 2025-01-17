import { MenuContext, NewIssueModalContext } from '@/app/contexts'
import { schema } from '@/lib/livestore/schema'
import { seed } from '@/lib/livestore/seed'
import { renderBootStatus } from '@/lib/livestore/utils'
import LiveStoreWorker from '@/lib/livestore/worker?worker'
import { Status } from '@/types/status'
import { LiveStoreProvider } from '@livestore/react'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { useNavigate } from 'react-router-dom'

const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

const adapter = makeAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
  // NOTE this should only be used for convenience when developing (i.e. via `?reset` in the URL) and is disabled in production
  resetPersistence,
})

export const Provider = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate()
  const [showMenu, setShowMenu] = React.useState(false)
  const [showNewIssueModal, setShowNewIssueModal] = React.useState<Status | boolean>(false)

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement
      if (element.classList.contains('input')) return
      if (e.key === 'c') {
        if (!element.classList.contains('input')) {
          setShowNewIssueModal(true)
          e.preventDefault()
        }
      }
      if (e.key === '/' && e.shiftKey) {
        navigate('/search')
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
      boot={seed}
      batchUpdates={batchUpdates}
    >
      <MenuContext.Provider value={{ showMenu, setShowMenu }}>
        <NewIssueModalContext.Provider value={{ showNewIssueModal, setShowNewIssueModal }}>
          {children}
        </NewIssueModalContext.Provider>
      </MenuContext.Provider>
    </LiveStoreProvider>
  )
}
