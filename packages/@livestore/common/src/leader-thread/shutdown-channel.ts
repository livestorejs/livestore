import type { WebChannel } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import {
  IntentionalShutdownCause,
  InvalidPullError,
  InvalidPushError,
  IsOfflineError,
  MaterializerHashMismatchError,
  SqliteError,
  UnexpectedError,
} from '../index.ts'

export class All extends Schema.Union(
  IntentionalShutdownCause,
  UnexpectedError,
  MaterializerHashMismatchError,
  IsOfflineError,
  InvalidPushError,
  InvalidPullError,
  SqliteError,
) {}

/**
 * Used internally by an adapter to shutdown gracefully.
 */
export type ShutdownChannel = WebChannel.WebChannel<typeof All.Type, typeof All.Type>
