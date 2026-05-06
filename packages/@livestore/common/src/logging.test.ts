import { describe, expect, test } from 'vitest'

import { Effect, Logger } from '@livestore/utils/effect'

import * as LogConfig from './logging.ts'

const makeCaptureLogger = (logs: string[], label: string) =>
  Logger.layer(
    [
      Logger.make(({ message }) => {
        logs.push(`${label}:${String(message)}`)
      }),
    ],
    { mergeWithExisting: false },
  )

describe('LogConfig.withLoggerConfig', () => {
  test('does not replace an existing custom logger when using default logger options', () => {
    const logs: string[] = []

    Effect.runSync(
      Effect.log('hello').pipe(
        LogConfig.withLoggerConfig(undefined, { threadName: 'livestore-test' }),
        Effect.provide(makeCaptureLogger(logs, 'existing')),
      ),
    )

    expect(logs).toEqual(['existing:hello'])
  })

  test('explicit logger option replaces an existing custom logger', () => {
    const existingLogs: string[] = []
    const configuredLogs: string[] = []

    Effect.runSync(
      Effect.log('hello').pipe(
        LogConfig.withLoggerConfig(
          { logger: makeCaptureLogger(configuredLogs, 'configured') },
          { threadName: 'livestore-test' },
        ),
        Effect.provide(makeCaptureLogger(existingLogs, 'existing')),
      ),
    )

    expect(existingLogs).toEqual([])
    expect(configuredLogs).toEqual(['configured:hello'])
  })

  test('applies the resolved minimum log level', () => {
    const logs: string[] = []

    Effect.runSync(
      Effect.logDebug('debug').pipe(
        LogConfig.withLoggerConfig({ logLevel: 'Info' }, { threadName: 'livestore-test' }),
        Effect.provide(makeCaptureLogger(logs, 'existing')),
      ),
    )

    expect(logs).toEqual([])
  })
})
