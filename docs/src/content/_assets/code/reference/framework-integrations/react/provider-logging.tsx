import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { LiveStoreProvider } from '@livestore/react'
import { Logger, LogLevel } from '@livestore/utils/effect'
import type { FC, ReactNode } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { schema } from './schema.ts'

// ---cut---

const adapter = makeInMemoryAdapter()

const App: FC = () => <div>App</div>

export const Root: FC<{ children: ReactNode }> = () => (
  <LiveStoreProvider
    schema={schema}
    adapter={adapter}
    batchUpdates={batchUpdates}
    // Optional: swap the logger implementation
    logger={Logger.prettyWithThread('app')}
    // Optional: set minimum log level (use LogLevel.None to disable)
    logLevel={LogLevel.Info}
  >
    <App />
  </LiveStoreProvider>
)
