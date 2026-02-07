import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider, useStore } from '@livestore/react'
import React, { memo, Suspense, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { ErrorBoundary } from 'react-error-boundary'
import LiveStoreWorker from './multi-backend.worker.ts?worker'
import { events, schema, tables } from './multi-backend-schema.ts'

type MultiBackendTestHandle = {
  commitBItem: (id: string, title: string) => void
  getBItems: () => ReadonlyArray<{ id: string; title: string }>
}

declare global {
  interface Window {
    __lsMultiBackendTest?: MultiBackendTestHandle
  }
}

export const MultiBackendRoot: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  const sp = new URLSearchParams(window.location.search)
  const reset = sp.get('reset') !== null
  const sessionId = sp.get('sessionId') ?? undefined
  const clientId = sp.get('clientId') ?? undefined
  const disableFastPath = sp.get('disableFastPath') !== null

  const adapter = React.useMemo(
    () =>
      makePersistedAdapter({
        storage: { type: 'opfs' },
        worker: LiveStoreWorker,
        sharedWorker: LiveStoreSharedWorker,
        resetPersistence: reset,
        sessionId,
        clientId,
        experimental: { disableFastPath },
      }),
    [reset, sessionId, clientId, disableFastPath],
  )

  return (
    <ErrorBoundary fallback={<div data-webtest="error">Error</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <AppWithStore adapter={adapter} />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}

const AppWithStore: React.FC<{ adapter: ReturnType<typeof makePersistedAdapter> }> = memo(({ adapter }) => {
  const store = useStore({
    storeId: 'adapter-web-multi-backend',
    schema,
    adapter,
    batchUpdates,
  })

  React.useEffect(() => {
    window.__lsMultiBackendTest = {
      commitBItem: (id, title) => {
        store.commit(events.bItemCreated({ id, title }))
      },
      getBItems: () => store.query(tables.b.items),
    }

    return () => {
      delete window.__lsMultiBackendTest
    }
  }, [store])

  return <div>Adapter Web Multi Backend App</div>
})
