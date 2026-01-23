import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { useStore } from '@livestore/solid'
import { Logger, LogLevel } from '@livestore/utils/effect'

import LiveStoreWorker from './livestore/livestore.worker.ts?worker'
import { schema } from './livestore/schema.ts'

// ---cut---

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export const useAppStore = () =>
  useStore({
    schema,
    adapter,
    storeId: 'default',
    // Optional: swap logger and minimum log level
    logger: Logger.prettyWithThread('window'),
    logLevel: LogLevel.Info, // use LogLevel.None to disable logs
  })
