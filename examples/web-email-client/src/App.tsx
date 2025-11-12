import { StoreRegistry, StoreRegistryProvider } from '@livestore/react/experimental'
import { Suspense, useEffect, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { ErrorBoundary } from 'react-error-boundary'
import { AppLayout } from './components/AppLayout.tsx'
import { mailboxStoreId } from './stores/mailbox/index.ts'

export const App: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))

  useInitializeMailboxStore()

  return (
    <div className="h-dvh bg-gray-100">
      <ErrorBoundary fallback={<AppError />}>
        <Suspense fallback={<AppLoading />}>
          <StoreRegistryProvider storeRegistry={storeRegistry}>
            <AppLayout />
          </StoreRegistryProvider>
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

export const useInitializeMailboxStore = () => {
  useEffect(() => {
    fetch(`${import.meta.env.VITE_LIVESTORE_SYNC_URL}/mailbox-client-do?storeId=${mailboxStoreId}`).catch((error) => {
      console.error('Failed to initialize Durable Mailbox Client Durable Object:', error)
    })
  }, [])
}

const AppError: React.FC = () => {
  return (
    <div className="grid place-items-center h-full">
      <p className="text-gray-500">Something went wrong</p>
    </div>
  )
}

const AppLoading: React.FC = () => {
  return (
    <div className="grid place-items-center h-full">
      <p className="text-gray-500">Loading...</p>
    </div>
  )
}
