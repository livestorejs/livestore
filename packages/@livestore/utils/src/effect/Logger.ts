import { Logger } from 'effect'

export * from 'effect/Logger'

const defaultDateFormat = (date: Date): string =>
  `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
    .getSeconds()
    .toString()
    .padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}`

export const prettyWithThread = (threadName: string) =>
  Logger.replace(
    Logger.defaultLogger,
    Logger.prettyLogger({
      formatDate: (date) => `${defaultDateFormat(date)} ${threadName}`,
    }),
  )
