import type { Layer, LogLevel } from '@livestore/utils/effect'

/**
 * Optional Effect logger configuration accepted by LiveStore entry points.
 *
 * When provided, `logger` replaces the default logger for the runtime.
 * Use `logLevel` to control verbosity. Set to `"None"` to disable logging
 * entirely while keeping the same logger implementation.
 */
export type LoggerOptions = {
  /** Optional Effect logger layer to control logging output. */
  logger?: Layer.Layer<never> | undefined
  /** Optional minimum log level for the runtime. */
  logLevel?: LogLevel.LogLevel | undefined
}
