import { Cause, Logger, References } from 'effect'

export * from 'effect/Logger'

const defaultDateFormat = (date: Date): string =>
  `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
    .getSeconds()
    .toString()
    .padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}`

export const prettyWithThread = (threadName: string, options: { mode?: 'tty' | 'browser' } = {}) =>
  Logger.layer([
    Logger.consolePretty({
      formatDate: (date) => `${defaultDateFormat(date)} ${threadName}`,
      mode: options.mode,
    }),
  ])

export const consoleLogger = (threadName: string) =>
  Logger.make(({ message, date, logLevel, cause, fiber }) => {
    const isCloudflareWorker = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
    const consoleFn =
      logLevel === 'Debug'
        ? // Cloudflare Workers doesn't support console.debug 🤷
          isCloudflareWorker === true
          ? console.log
          : console.debug
        : logLevel === 'Info'
          ? console.info
          : logLevel === 'Warn'
            ? console.warn
            : console.error

    const annotationsObj = fiber.getRef(References.CurrentLogAnnotations)

    const messages = Array.isArray(message) === true ? message : [message]
    if (cause.reasons.length > 0) {
      messages.push(Cause.pretty(cause))
    }

    if (Object.keys(annotationsObj).length > 0) {
      messages.push(annotationsObj)
    }

    consoleFn(`[${defaultDateFormat(date)} ${threadName}]`, ...messages)
  })

export const consoleWithThread = (threadName: string) => Logger.layer([consoleLogger(threadName)])
