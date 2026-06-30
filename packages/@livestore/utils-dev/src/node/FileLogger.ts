import util from 'node:util'

import { Redactable } from 'effect'

import { Cause, Inspectable, Logger, type LogLevel, References, ReadonlyArray } from '@livestore/utils/effect'

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

const logLevelColors: Record<LogLevel.LogLevel, ReadonlyArray<string>> = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warn: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black],
}

export const formatLogTime = (date: Date): string =>
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

type PrettyLoggerOptions = {
  readonly colors: boolean
  readonly stderr: boolean
  readonly formatDate: (date: Date) => string
  readonly onLog?: (str: string) => void
}

export const formatPrettyLog = ({
  annotations,
  cause,
  date,
  fiberId,
  logLevel,
  message: message_,
  options,
  spans,
}: {
  readonly annotations: Readonly<Record<string, unknown>>
  readonly cause: Cause.Cause<unknown>
  readonly date: Date
  readonly fiberId: number
  readonly logLevel: LogLevel.LogLevel
  readonly message: unknown
  readonly options: PrettyLoggerOptions
  readonly spans: ReadonlyArray<readonly [label: string, timestamp: number]>
}) => {
  const color = options.colors === true ? withColor : withColorNoop
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

  let firstLine =
    color(`[${options.formatDate(date)}]`, colors.white) +
    ` ${color(logLevel.toUpperCase(), ...logLevelColors[logLevel])}` +
    ` (#${fiberId})`

  if (spans.length > 0) {
    const now = date.getTime()
    for (const [label, timestamp] of spans) {
      firstLine += ` ${label}=${now - timestamp}ms`
    }
  }

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
        logIndented(Redactable.redact(msg))
      }
    }
  }

  for (const [key, value] of Object.entries(annotations)) {
    const formattedValue =
      typeof value === 'object' && value !== null
        ? util.inspect(structuredMessage(value), {
            depth: 3,
            colors: false,
            compact: false,
            breakLength: 120,
          })
        : Redactable.redact(value)
    logIndented(color(`${key}:`, colors.bold, colors.white), formattedValue)
  }

  // if (!processIsBun) console.groupEnd()

  return str
}
