/// <reference types="vite/client" />

import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import type React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { EmailLayout } from './components/EmailLayout.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'
import { schema } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'

/**
 * Email Client App - LiveStore Multi-Aggregate Prototype
 *
 * Demonstrates:
 * - Two-aggregate architecture (Labels & Threads)
 * - Cross-aggregate event flow
 * - Real-time synchronization
 * - Offline-first design
 */

// Check for reset parameter to clear persistence
const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

if (resetPersistence) {
  const searchParams = new URLSearchParams(window.location.search)
  searchParams.delete('reset')
  window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
}

// Create LiveStore adapter
const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  resetPersistence,
})

export const App: React.FC = () => (
  <LiveStoreProvider
    schema={schema}
    adapter={adapter}
    renderLoading={({ stage }) => (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <div className="text-4xl mb-4">📧</div>
          <div className="text-lg font-medium text-gray-900 mb-2">Loading Email Client Prototype</div>
          <div className="text-sm text-gray-500 mb-4">Stage: {stage}</div>
          <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
          <div className="mt-4 text-xs text-gray-400">Initializing LiveStore multi-aggregate architecture...</div>
        </div>
      </div>
    )}
    batchUpdates={batchUpdates}
  >
    <div className="h-screen bg-gray-100">
      <EmailLayout />
    </div>
    <VersionBadge />
  </LiveStoreProvider>
)
