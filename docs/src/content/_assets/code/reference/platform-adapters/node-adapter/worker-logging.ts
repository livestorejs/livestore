import { makeWorker } from '@livestore/adapter-node/worker'
import { Logger, LogLevel } from '@livestore/utils/effect'

import { schema } from './schema.ts'

makeWorker({
  schema,
  // readable console output by thread name
  logger: Logger.prettyWithThread('livestore-node-leader-thread'),
  // choose verbosity: None | Error | Warning | Info | Debug
  logLevel: LogLevel.Info,
})
