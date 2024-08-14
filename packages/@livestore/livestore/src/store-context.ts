import type { IntentionalShutdownCause, UnexpectedError } from '@livestore/common'
import { Schema } from '@livestore/utils/effect'

import type { Store } from './store.js'

export type LiveStoreContext =
  | LiveStoreContextRunning
  | {
      stage: 'error'
      error: UnexpectedError | unknown
    }
  | {
      stage: 'shutdown'
      cause: IntentionalShutdownCause | StoreAbort
    }

export class StoreAbort extends Schema.TaggedError<StoreAbort>()('LiveStore.StoreAbort', {}) {}
export class StoreInterrupted extends Schema.TaggedError<StoreInterrupted>()('LiveStore.StoreInterrupted', {}) {}

export type LiveStoreContextRunning = {
  stage: 'running'
  store: Store
}
