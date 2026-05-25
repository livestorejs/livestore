import type { WebChannel } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import {
  BackendIdMismatchError,
  IntentionalShutdownCause,
  MaterializeError,
  UnknownError,
} from '../index.ts'

export const All = Schema.Union([IntentionalShutdownCause, UnknownError, BackendIdMismatchError, MaterializeError])
export type All = typeof All.Type

/**
 * Used internally by an adapter to shutdown gracefully.
 */
export type ShutdownChannel = WebChannel.WebChannel<typeof All.Type, typeof All.Type>
