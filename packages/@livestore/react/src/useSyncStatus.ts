import React from 'react'

import type { Store, SyncStatus } from '@livestore/livestore'

/**
 * React hook that subscribes to sync status changes.
 *
 * Returns the current synchronization status between the client session and
 * the leader thread. The component re-renders whenever the sync status changes.
 *
 * @example
 * ```tsx
 * function SyncIndicator() {
 *   const status = store.useSyncStatus()
 *   return <span>{status.isSynced ? '✓ Synced' : `Syncing (${status.pendingCount} pending)...`}</span>
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

  React.useDebugValue(`LiveStore:useSyncStatus:${status.isSynced ? 'synced' : 'pending'}`)

  return status
}
