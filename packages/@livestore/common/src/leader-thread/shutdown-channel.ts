import type { WebChannel } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import {
  IntentionalShutdownCause,
  InvalidPullError,
  IsOfflineError,
  MaterializerHashMismatchError,
  SqliteError,
  SyncError,
  UnexpectedError,
} from '../index.ts'

export class All extends Schema.Union(
  IntentionalShutdownCause,
  UnexpectedError,
  SyncError,
  MaterializerHashMismatchError,
  IsOfflineError,
  InvalidPullError,
  SqliteError,
) {}

/**
 * Used internally by an adapter to shutdown gracefully.
 */
export type ShutdownChannel = WebChannel.WebChannel<typeof All.Type, typeof All.Type>
