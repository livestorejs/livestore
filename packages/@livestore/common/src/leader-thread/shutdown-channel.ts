import type { WebChannel } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import {
  BackendIdMismatchError,
  IntentionalShutdownCause,
  InvalidPullError,
  InvalidPushError,
  MaterializeError,
  UnknownError,
} from '../index.ts'

export class All extends Schema.Union(
  IntentionalShutdownCause,
  UnknownError,
  InvalidPushError,
  InvalidPullError,
  BackendIdMismatchError,
  MaterializeError,
) {}

/**
 * Used internally by an adapter to shutdown gracefully.
 */
export type ShutdownChannel = WebChannel.WebChannel<typeof All.Type, typeof All.Type>
