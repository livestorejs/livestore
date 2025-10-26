import type { WebChannel } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import {
  IntentionalShutdownCause,
  InvalidPullError,
  InvalidPushError,
  IsOfflineError,
  MaterializeError,
  UnexpectedError,
} from '../index.ts'

export class All extends Schema.Union(
  IntentionalShutdownCause,
  UnexpectedError,
  IsOfflineError,
  InvalidPushError,
  InvalidPullError,
  MaterializeError,
) {}

/**
 * Used internally by an adapter to shutdown gracefully.
 */
export type ShutdownChannel = WebChannel.WebChannel<typeof All.Type, typeof All.Type>
