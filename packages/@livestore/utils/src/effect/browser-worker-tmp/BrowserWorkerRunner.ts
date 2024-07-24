/**
 * @since 1.0.0
 */
import type * as Layer from 'effect/Layer'

import type * as Runner from '../worker-tmp/WorkerRunner.js'
import * as internal from './internal/workerRunner.js'

/**
 * @since 1.0.0
 * @category layers
 */
export const layer: Layer.Layer<Runner.PlatformRunner> = internal.layer
export { layerMessagePort } from './port-platform-runner.js'
