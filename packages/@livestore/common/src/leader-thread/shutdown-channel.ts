import type { WebChannel } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

import { IntentionalShutdownCause, UnexpectedError } from '../index.js'

export class All extends Schema.Union(IntentionalShutdownCause, UnexpectedError) {}

/**
 * Used internally by an adapter to shutdown gracefully.
 */
export type ShutdownChannel = WebChannel.WebChannel<typeof All.Type, typeof All.Type>
