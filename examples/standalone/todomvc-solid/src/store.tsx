// import type { BaseGraphQLContext, LiveStoreSchema } from '@livestore/livestore'
// import { createStore } from '@livestore/livestore'
// import type { LiveStoreContextRunning } from '@livestore/livestore/dist/effect/LiveStore'
// import type { CreateStoreOptions } from '@livestore/livestore/dist/store'
// import type { LiveStoreContext as StoreContext_ } from '@livestore/livestore/dist/store-context'
// import { StoreAbort, StoreInterrupted } from '@livestore/livestore/dist/store-context'
import { getStore } from '@livestore/solid'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'

// import { Effect, FiberSet, Logger, LogLevel } from 'effect'
// import { createEffect, createSignal, onCleanup } from 'solid-js'
// import type { BootStatus, IntentionalShutdownCause, UnexpectedError } from '../../../packages/@livestore/common/dist'
import LiveStoreWorker from './livestore.worker?worker'
import { schema } from './schema/index.js'

const adapterFactory = makeAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export const store = await getStore<typeof schema>({
  adapter: adapterFactory,
  schema,
  storeId: 'default',
})
