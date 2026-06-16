import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { useStore } from '@livestore/react'
import { Logger } from '@livestore/utils/effect'

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
    logger: Logger.layer([Logger.consolePretty()]),
    // Optional: set minimum log level (use "None" to disable)
    logLevel: 'Info',
  })
