import { makeWorker } from '@livestore/adapter-node/worker'
import { Logger } from '@livestore/utils/effect'

import { schema } from './schema.ts'

makeWorker({
  schema,
  // readable console output
  logger: Logger.layer([Logger.consolePretty()]),
  // choose verbosity: None | Error | Warn | Info | Debug
  logLevel: 'Info',
})
