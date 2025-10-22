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
   * Whether the sync backend should reactively pull new events from the sync backend
   * @default true
   */
  livePull?: boolean
}
