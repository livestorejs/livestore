/// <reference types="vite/client" />

import { StoreRegistry, StoreRegistryProvider } from '@livestore/react/experimental'
import { Suspense, useEffect, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { EmailLayout } from './components/EmailLayout.tsx'
import { mailboxStoreId } from './stores/mailbox/index.ts'

/**
 * Email Client - LiveStore Multi-Store Demo
 *
 * Demonstrates:
 * - Two-store architecture (Mailbox & Threads)
 * - Cross-store event flow
 */
export const App: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))

  useInitializeMailboxStore()

  return (
    <StoreRegistryProvider storeRegistry={storeRegistry}>
      <Suspense fallback={<AppLoading />}>
        <EmailLayout />
      </Suspense>
    </StoreRegistryProvider>
  )
}

const AppLoading: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
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

// hook version of MailboxStoreInitializer
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
