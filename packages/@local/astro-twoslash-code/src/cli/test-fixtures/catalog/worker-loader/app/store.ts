/// <reference types="vite/client" />

import { schema } from './schema.ts'
import LiveStoreWorker from './worker.ts?worker'

export const adapter = {
  worker: LiveStoreWorker,
  schema,
}
