import { makeAdapterFactory } from '../make-adapter-factory.js'
import type { WebAdapterOptions } from './coordinator.js'
import { makeCoordinator } from './coordinator.js'

export { type WebAdapterOptions, makeCoordinator } from './coordinator.js'

export const makeAdapter = (options: WebAdapterOptions) => makeAdapterFactory(makeCoordinator(options))
