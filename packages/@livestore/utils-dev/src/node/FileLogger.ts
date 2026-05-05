import * as fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import {
  Cause,
  Effect,
  Inspectable,
  Layer,
  Logger,
  type LogLevel,
  ReadonlyArray,
} from '@livestore/utils/effect'

export const makeFileLogger = (
  logFilePath: string,
  options?: {
    readonly threadName: string
    readonly colors?: boolean
  },
) =>
  Layer.unwrapScoped(
    Effect.gen(function* () {
      yield* Effect.sync(() => fs.mkdirSync(path.dirname(logFilePath), { recursive: true }))

      const logFile = yield* Effect.acquireRelease(
        Effect.sync(() => fs.openSync(logFilePath, 'a', 0o666)),
        (fd) => Effect.sync(() => fs.closeSync(fd)),
      )

      return Logger.replace(
        Logger.defaultLogger,
        prettyLoggerTty({
          colors: options?.colors ?? false,
          stderr: false,
          formatDate: (date) => `${defaultDateFormat(date)} ${options?.threadName ?? ''}`,
          onLog: (str) => fs.writeSync(logFile, str),
        }),
      )
    }),
  )

const withColor = (text: string, ...colors: ReadonlyArray<string>) => {
  let out = ''
  for (let i = 0; i < colors.length; i++) {
    out += `\x1b[${colors[i]}m`
  }
  return `${out}${text}\x1b[0m`
}
const withColorNoop = (text: string, ..._colors: ReadonlyArray<string>) => text

const colors = {
  bold: '1',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  cyan: '36',
  white: '37',
  gray: '90',
  black: '30',
  bgBrightRed: '101',
} as const

const logLevelColors: Record<LogLevel.LogLevel['_tag'], ReadonlyArray<string>> = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warn: [colors.yellow],
  Warning: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black],
}

export const defaultDateFormat = (date: Date): string =>
  `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
    .getSeconds()
    .toString()
    .padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}`

export const structuredMessage = (u: unknown): unknown => {
  switch (typeof u) {
    case 'bigint':
    case 'function':
    case 'symbol': {
      return String(u)
    }
    default: {
      return Inspectable.toJson(u)
    }
  }
}

const consoleLogToString = (...s: any[]) => {
  if (s.length === 0) return ''
  const [first, ...rest] = s
  if (typeof first === 'string') {
    return rest.length > 0 ? util.format(first, ...rest.map(structuredMessage)) : first
  }
  return s
    .map((v) => {
      if (typeof v === 'string') return v
      return util.inspect(structuredMessage(v), {
        depth: 3,
        colors: false,
        compact: false,
        breakLength: 120,
      })
    })
    .join(' ')
}

export const prettyLoggerTty = (options: {
  readonly colors: boolean
  readonly stderr: boolean
  readonly formatDate: (date: Date) => string
  readonly onLog?: (str: string) => void
}) => {
  const color = options.colors === true ? withColor : withColorNoop
  return Logger.make<unknown, string>((options_) => {
    const {
      annotations,
      cause = Cause.empty,
      date,
      fiber,
      logLevel,
      message: message_,
    } = options_ as any
    let str = ''

    const log = (...s: any[]) => {
      str += `${consoleLogToString(...s)}\n`
      options.onLog?.(str)
    }

    const logIndented = (...s: any[]) => {
      str += `${consoleLogToString(...s).replace(/^/gm, '  ')}\n`
      options.onLog?.(str)
    }

    const message = ReadonlyArray.ensure(message_)
    const logLevelKey = typeof logLevel === 'string' ? logLevel : logLevel._tag
    const logLevelLabel = typeof logLevel === 'string' ? (logLevel === 'Warn' ? 'WARN' : logLevel.toUpperCase()) : logLevel.label

    let firstLine =
      color(`[${options.formatDate(date)}]`, colors.white) +
      ` ${color(logLevelLabel, ...logLevelColors[logLevelKey])}` +
      ` (#${fiber?.id ?? 0})`

    firstLine += ':'
    let messageIndex = 0
    if (message.length > 0) {
      const firstMaybeString = structuredMessage(message[0])
      if (typeof firstMaybeString === 'string') {
        firstLine += ` ${color(firstMaybeString, colors.bold, colors.cyan)}`
        messageIndex++
      }
    }

    log(firstLine)
    // if (!processIsBun) console.group()

    if (cause.reasons.length > 0) {
      logIndented(Cause.pretty(cause))
    }

    if (messageIndex < message.length) {
      for (; messageIndex < message.length; messageIndex++) {
        const msg = message[messageIndex]
        if (typeof msg === 'object' && msg !== null) {
          logIndented(
            util.inspect(structuredMessage(msg), {
              depth: 3,
              colors: false,
              compact: false,
              breakLength: 120,
            }),
          )
        } else {
          logIndented(Inspectable.redact(msg))
        }
      }
    }

    const annotationEntries =
      annotations === undefined
        ? []
        : typeof annotations[Symbol.iterator] === 'function'
          ? Array.from(annotations as Iterable<[string, unknown]>)
          : Object.entries(annotations)

    if (annotationEntries.length > 0) {
      for (const [key, value] of annotationEntries) {
        const formattedValue =
          typeof value === 'object' && value !== null
            ? util.inspect(structuredMessage(value), {
                depth: 3,
                colors: false,
                compact: false,
                breakLength: 120,
              })
            : Inspectable.redact(value)
        logIndented(color(`${key}:`, colors.bold, colors.white), formattedValue)
      }
    }

    // if (!processIsBun) console.groupEnd()

    return str
  })
}
