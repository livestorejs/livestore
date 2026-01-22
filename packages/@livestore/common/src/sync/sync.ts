export * from './errors.ts'
export * as SyncBackend from './sync-backend.ts'

import type { Schema } from '@livestore/utils/effect'
import type { InitialSyncOptions } from '../leader-thread/types.ts'
import type { SyncBackendConstructor } from './sync-backend.ts'

export type SyncOptions<TPayload = Schema.JsonValue> = {
  backend?: SyncBackendConstructor<any, TPayload>
  /** @default { _tag: 'Skip' } */
  initialSyncOptions?: InitialSyncOptions
  /**
   * What to do if there is an error during sync.
   *
   * Options:
   * `shutdown` will stop the sync processor and cause the app to crash.
   * `ignore` will log the error and let the app continue running acting as if it was offline.
   *
   * @default 'ignore'
   * */
  onSyncError?: 'shutdown' | 'ignore'
  /**
   * What to do when the sync backend identity has changed (i.e. the backend was reset).
   *
   * This commonly happens during development when:
   * - The sync backend state is deleted (e.g. `.wrangler/state` for Cloudflare)
   * - Running with a `--reset` flag
   * - Schema changes require re-backfilling data
   *
   * Options:
   * - `'reset'`: Clear local storage (eventlog and state databases) and shutdown.
   *   The app will need to restart and will sync fresh data from the backend.
   *   This is the recommended option for development.
   * - `'shutdown'`: Shutdown without clearing local storage.
   *   On restart, the client will still have stale data and hit the same error.
   * - `'ignore'`: Log the error and continue running.
   *   The client will show stale data but keep running (effectively offline mode).
   *
   * @default 'reset'
   */
  onBackendIdMismatch?: 'reset' | 'shutdown' | 'ignore'
  /**
   * Whether the sync backend should reactively pull new events from the sync backend
   * @default true
   */
  livePull?: boolean
}
