import { schema } from '@/lib/livestore/schema'
import { seed } from '@/lib/livestore/seed'
import { renderBootStatus } from '@/lib/livestore/utils'
import LiveStoreWorker from '@/lib/livestore/worker?worker'
import { LiveStoreProvider } from '@livestore/react'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import { FPSMeter } from '@overengineering/fps-meter'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

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

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}

export const MenuContext = React.createContext(null as MenuContextInterface | null)

export const Provider = ({ children }: { children: React.ReactNode }) => {
  const [showMenu, setShowMenu] = React.useState(false)

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      renderLoading={renderBootStatus}
      boot={seed}
      batchUpdates={batchUpdates}
    >
      <FPSMeter className="absolute right-1 z-50 bottom-1 bg-black/30" height={40} />
      <MenuContext.Provider value={{ showMenu, setShowMenu }}>{children}</MenuContext.Provider>
    </LiveStoreProvider>
  )
}
