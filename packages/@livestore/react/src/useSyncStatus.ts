import React from 'react'

import type { Store, SyncStatus } from '@livestore/livestore'

/**
 * React hook that subscribes to sync status changes.
 *
 * Returns the current synchronization status across the session-to-leader and
 * leader-to-backend boundaries. The component re-renders whenever either
 * boundary changes.
 *
 * @example
 * ```tsx
 * function SyncIndicator() {
 *   const status = store.useSyncStatus()
 *   return <span>{status.isBackendSynced ? '✓ Backend confirmed' : 'Syncing...'}</span>
 * }
 * ```
 *
 * @param options - Options containing the store instance
 * @returns The current sync status
 */
export const useSyncStatus = (options: { store: Store<any> }): SyncStatus => {
  const { store } = options

  const [status, setStatus] = React.useState<SyncStatus>(() => store.syncStatus())

  React.useEffect(() => {
    return store.subscribeSyncStatus(setStatus)
  }, [store])

  React.useDebugValue(`LiveStore:useSyncStatus:${status.isBackendSynced === true ? 'backend-synced' : 'pending'}`)

  return status
}
