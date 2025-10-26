import { Cause, HashMap, Logger, LogLevel } from 'effect'

export * from 'effect/Logger'

const defaultDateFormat = (date: Date): string =>
  `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
    .getSeconds()
    .toString()
    .padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}`

export const prettyWithThread = (threadName: string, options: { mode?: 'tty' | 'browser' } = {}) =>
  Logger.replace(
    Logger.defaultLogger,
    Logger.prettyLogger({
      formatDate: (date) => `${defaultDateFormat(date)} ${threadName}`,
      mode: options.mode,
    }),
  )

export const consoleLogger = (threadName: string) =>
  Logger.make(({ message, annotations, date, logLevel, cause }) => {
    const isCloudflareWorker = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
    const consoleFn =
      logLevel === LogLevel.Debug
        ? // Cloudflare Workers doesn't support console.debug 🤷
          isCloudflareWorker
          ? console.log
          : console.debug
        : logLevel === LogLevel.Info
          ? console.info
          : logLevel === LogLevel.Warning
            ? console.warn
            : console.error

    const annotationsObj = Object.fromEntries(HashMap.entries(annotations))

    const messages = Array.isArray(message) ? message : [message]
    if (Cause.isEmpty(cause) === false) {
      messages.push(Cause.pretty(cause, { renderErrorCause: true }))
    }

    if (Object.keys(annotationsObj).length > 0) {
      messages.push(annotationsObj)
    }

    consoleFn(`[${defaultDateFormat(date)} ${threadName}]`, ...messages)
  })

export const consoleWithThread = (threadName: string) => Logger.replace(Logger.defaultLogger, consoleLogger(threadName))
