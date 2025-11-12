import { StoreRegistry, StoreRegistryProvider } from '@livestore/react/experimental'
import { Suspense, useEffect, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { ErrorBoundary } from 'react-error-boundary'
import { EmailLayout } from './components/EmailLayout.tsx'
import { mailboxStoreId } from './stores/mailbox/index.ts'

export const App: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))

  useInitializeMailboxStore()

  return (
    <ErrorBoundary fallback={<AppError />}>
      <Suspense fallback={<AppLoading />}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <EmailLayout />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}

const AppError: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-dvh bg-gray-100">
      <div className="text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <div className="text-lg font-medium text-red-600 mb-2">Application Error</div>
        <p className="text-gray-600 max-w-md mb-6">Something went wrong. Please refresh the page to try again.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
        >
          Refresh Page
        </button>
      </div>
    </div>
  )
}

const AppLoading: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-dvh bg-gray-100">
      <div className="text-center">
        <div className="text-4xl mb-4">📧</div>
        <div className="text-lg font-medium text-gray-900 mb-2">Loading Email Client</div>
        <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden mx-auto">
          <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
        <div className="mt-4 text-xs text-gray-400">Initializing LiveStore multi-store architecture...</div>
      </div>
    </div>
  )
}

export const useInitializeMailboxStore = () => {
  useEffect(() => {
    fetch(`${import.meta.env.VITE_LIVESTORE_SYNC_URL}/mailbox-client-do?storeId=${mailboxStoreId}`)
      .then((data) => {
        console.log('Mailbox Client Durable Object state initialized:', data)
      })
      .catch((error) => {
        console.error('Failed to initialize Durable Mailbox Client Durable Object:', error)
      })
  }, [])
}
