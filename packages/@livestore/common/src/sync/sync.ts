export * from './errors.ts'
export * as SyncBackend from './sync-backend.ts'

import type { InitialSyncOptions } from '../leader-thread/types.ts'
import type { SyncBackendConstructor } from './sync-backend.ts'

export type SyncOptions = {
  backend?: SyncBackendConstructor<any>
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
}
