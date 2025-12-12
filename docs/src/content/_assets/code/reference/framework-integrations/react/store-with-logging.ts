import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { useStore } from '@livestore/react'
import { Logger, LogLevel } from '@livestore/utils/effect'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { schema } from './schema.ts'

const adapter = makeInMemoryAdapter()

// ---cut---
export const useAppStore = () =>
  useStore({
    storeId: 'app-root',
    schema,
    adapter,
    batchUpdates,
    // Optional: swap the logger implementation
    logger: Logger.prettyWithThread('app'),
    // Optional: set minimum log level (use LogLevel.None to disable)
    logLevel: LogLevel.Info,
  })