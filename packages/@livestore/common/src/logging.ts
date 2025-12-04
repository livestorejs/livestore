import { isDevEnv } from '@livestore/utils'
import { Effect, type Layer, Logger, LogLevel } from '@livestore/utils/effect'

/**
 * Optional Effect logger configuration that LiveStore entry points accept.
 *
 * When provided, `logger` replaces the default pretty logger for the runtime.
 * Use `logLevel` to control verbosity. Set to `LogLevel.None` to disable logging
 * entirely while keeping the same logger implementation.
 */
export type WithLoggerOptions = {
  /** Optional Effect logger layer to control logging output. */
  logger?: Layer.Layer<never> | undefined
  /** Optional minimum log level for the runtime. */
  logLevel?: LogLevel.LogLevel | undefined
}

/**
 * Common defaults for resolving a logger configuration.
 * - `threadName` is used by the default pretty logger when `logger` is not provided.
 * - `mode` selects pretty logger mode (e.g. 'browser' for web workers).
 * - `defaultLogLevel` is used when `logLevel` is not provided.
 */
export type LoggerDefaults = {
  threadName?: string
  mode?: 'tty' | 'browser'
  defaultLogLevel?: LogLevel.LogLevel
  /** Optional default logger layer to use when `config.logger` is not provided. */
  defaultLogger?: Layer.Layer<never>
}

/**
 * Resolve the logger layer to provide to the Effect runtime.
 */
export const resolveLoggerLayer = (config?: WithLoggerOptions, defaults?: LoggerDefaults): Layer.Layer<never> => {
  if (config?.logger) return config.logger
  if (defaults?.defaultLogger) return defaults.defaultLogger
  const threadName = defaults?.threadName ?? 'livestore'
  const mode = defaults?.mode
  return Logger.prettyWithThread(threadName, mode ? { mode } : {})
}

/**
 * Resolve the minimum log level, falling back to `defaults.defaultLogLevel` then `LogLevel.Debug`.
 */
export const resolveLogLevel = (config?: WithLoggerOptions, defaults?: LoggerDefaults): LogLevel.LogLevel => {
  if (config?.logLevel !== undefined) return config.logLevel
  if (defaults?.defaultLogLevel !== undefined) return defaults.defaultLogLevel
  return isDevEnv() ? LogLevel.Debug : LogLevel.Info
}

/**
 * Wrap an effect by applying the resolved minimum log level and providing the resolved logger layer.
 */
export const withLoggerConfig = <TEnv, TError, TOut>(
  config?: WithLoggerOptions,
  defaults?: LoggerDefaults,
): ((effect: Effect.Effect<TOut, TError, TEnv>) => Effect.Effect<TOut, TError, TEnv>) => {
  const level = resolveLogLevel(config, defaults)
  const layer = resolveLoggerLayer(config, defaults)
  return (effect) => effect.pipe(Logger.withMinimumLogLevel(level), Effect.provide(layer))
}
