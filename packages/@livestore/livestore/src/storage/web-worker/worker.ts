// Web Worker file for running SQLite in a web worker.
import { makeWorker } from './make-worker.js'

makeWorker()

export type WrappedWorker = ReturnType<typeof makeWorker>
