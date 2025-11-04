/// <reference types="vite/client" />

import { StoreRegistry, StoreRegistryProvider } from '@livestore/react/experimental'
import { Suspense, useEffect, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { EmailLayout } from './components/EmailLayout.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'
import { labelsStoreId } from './stores/labels/index.ts'

/**
 * Email Client - LiveStore Multi-Aggregate Demo
 *
 * Demonstrates:
 * - Two-aggregate architecture (Labels & Threads)
 * - Cross-aggregate event flow
 */
export const App: React.FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))

  useInitializeLabelsStore()

  return (
    <StoreRegistryProvider storeRegistry={storeRegistry}>
      <Suspense fallback={<AppLoading />}>
        <div className="h-screen bg-gray-100">
          <EmailLayout />
        </div>
        <VersionBadge />
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
        <div className="mt-4 text-xs text-gray-400">Initializing LiveStore multi-aggregate architecture...</div>
      </div>
    </div>
  )
}

// hook version of LabelsStoreInitializer
export const useInitializeLabelsStore = () => {
  useEffect(() => {
    fetch(`${import.meta.env.VITE_LIVESTORE_SYNC_URL}/labels-client-do?storeId=${labelsStoreId}`)
      .then((res) => res.json())
      .then((data) => {
        console.log('Labels Client Durable Object state initialized:', data)
      })
      .catch((error) => {
        console.error('Failed to initialize Durable Labels Client Durable Object:', error)
      })
  }, [])
}
