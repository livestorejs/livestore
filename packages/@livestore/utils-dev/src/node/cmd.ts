import {
  Cause,
  ChildProcess,
  ChildProcessSpawner,
  Effect,
  Fiber,
  Logger,
  type PlatformError,
  Predicate,
  References,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { NodeFileSystem } from '@livestore/utils/node'

import { applyLoggingToCommand } from './cmd-log.ts'
import * as FileLogger from './FileLogger.ts'
import { CurrentWorkingDirectory } from './workspace.ts'

// Branded zero value so we can compare exit codes without touching internals.
const SUCCESS_EXIT_CODE: ChildProcessSpawner.ExitCode = ChildProcessSpawner.ExitCode(0)

export const cmd: (
  commandInput: string | (string | undefined)[],
  options?: {
    stderr?: 'inherit' | 'pipe'
    stdout?: 'inherit' | 'pipe'
    shell?: boolean
    env?: Record<string, string | undefined>
    /**
     * When provided, streams command output to terminal AND to a canonical log file (`${logDir}/dev.log`) in this directory.
     * Also archives the previous run to `${logDir}/archive/dev-<ISO>.log` and keeps only the latest 50 archives.
     */
    logDir?: string
    /** Optional basename for the canonical log file; defaults to 'dev.log' */
    logFileName?: string
    /** Optional number of archived logs to retain; defaults to 50 */
    logRetention?: number
  },
) => Effect.Effect<
  ChildProcessSpawner.ExitCode,
  PlatformError.PlatformError | CmdError,
  ChildProcessSpawner.ChildProcessSpawner | CurrentWorkingDirectory
> = Effect.fn('cmd')(function* (commandInput, options) {
  const cwd = yield* CurrentWorkingDirectory

  const asArray = Array.isArray(commandInput)
  const parts = asArray === true ? commandInput.filter(Predicate.isNotUndefined) : undefined
  const [command, ...args] = asArray === true ? (parts as string[]) : commandInput.split(' ')

  const debugEnvStr = Object.entries(options?.env ?? {})
    .map(([key, value]) => `${key}='${String(value)}' `)
    .join('')

  const loggingOpts = {
    ...(options?.logDir !== undefined ? { logDir: options.logDir } : {}),
    ...(options?.logFileName !== undefined ? { logFileName: options.logFileName } : {}),
    ...(options?.logRetention !== undefined ? { logRetention: options.logRetention } : {}),
  } as const
  const { input: finalInput, subshell: needsShell, logPath } = yield* applyLoggingToCommand(commandInput, loggingOpts)

  const stdoutMode = options?.stdout ?? 'inherit'
  const stderrMode = options?.stderr ?? 'inherit'
  const useShell = (options?.shell === true ? true : false) || needsShell

  const commandDebugStr = debugEnvStr + (Array.isArray(finalInput) === true ? finalInput.join(' ') : finalInput)
  const subshellStr = useShell === true ? ' (in subshell)' : ''

  yield* Effect.logDebug(`Running '${commandDebugStr}' in '${cwd}'${subshellStr}`)
  yield* Effect.annotateCurrentSpan({
    'span.label': commandDebugStr,
    cwd,
    command,
    args,
    logDir: options?.logDir,
  })

  const baseArgs = {
    commandInput: finalInput,
    cwd,
    env: options?.env ?? {},
    stdoutMode,
    stderrMode,
    useShell,
  } as const

  const exitCode = yield* Predicate.isNotUndefined(logPath) === true
    ? Effect.gen(function* () {
        yield* Effect.sync(() => console.log(`Logging output to ${logPath}`))
        return yield* runWithLogging({ ...baseArgs, logPath, threadName: commandDebugStr })
      })
    : runWithoutLogging(baseArgs)

  if (exitCode !== SUCCESS_EXIT_CODE) {
    return yield* CmdError.make({
      command: command!,
      args,
      cwd,
      env: options?.env ?? {},
      stderr: stderrMode,
    })
  }

  return exitCode
})

export const cmdText: (
  commandInput: string | (string | undefined)[],
  options?: {
    stderr?: 'inherit' | 'pipe'
    runInShell?: boolean
    env?: Record<string, string | undefined>
  },
) => Effect.Effect<
  string,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | CurrentWorkingDirectory
> = Effect.fn('cmdText')(function* (commandInput, options) {
  const cwd = yield* CurrentWorkingDirectory
  const commandParts =
    Array.isArray(commandInput) === true ? commandInput.filter(Predicate.isNotUndefined) : commandInput.split(' ')
  const [command, ...args] = commandParts
  const debugEnvStr = Object.entries(options?.env ?? {})
    .map(([key, value]) => `${key}='${String(value)}' `)
    .join('')

  const commandDebugStr = debugEnvStr + [command, ...args].join(' ')
  const subshellStr = options?.runInShell === true ? ' (in subshell)' : ''

  yield* Effect.logDebug(`Running '${commandDebugStr}' in '${cwd}'${subshellStr}`)
  yield* Effect.annotateCurrentSpan({ 'span.label': commandDebugStr, command, cwd })

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* spawner.string(
    buildCommand(commandParts, {
      cwd,
      env: options?.env ?? {},
      stderr: options?.stderr ?? 'inherit',
      shell: options?.runInShell === true,
    }),
  )
})

export class CmdError extends Schema.TaggedErrorClass<CmdError>('~@livestore/utils-dev/CmdError')('CmdError', {
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  env: Schema.Record(Schema.String, Schema.String.pipe(Schema.UndefinedOr)),
  stderr: Schema.Literals(['inherit', 'pipe']),
}) {}

type TRunBaseArgs = {
  readonly commandInput: string | string[]
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly stdoutMode: 'inherit' | 'pipe'
  readonly stderrMode: 'inherit' | 'pipe'
  readonly useShell: boolean
}

const runWithoutLogging = ({ commandInput, cwd, env, stdoutMode, stderrMode, useShell }: TRunBaseArgs) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return yield* spawner.exitCode(
      buildCommand(commandInput, {
        cwd,
        env,
        stdin: 'inherit',
        stdout: stdoutMode,
        stderr: stderrMode,
        shell: useShell,
      }),
    )
  })

type TRunWithLoggingArgs = TRunBaseArgs & {
  readonly logPath: string
  readonly threadName: string
}

const runWithLogging = ({
  commandInput,
  cwd,
  env,
  stdoutMode,
  stderrMode,
  useShell,
  logPath,
  threadName,
}: TRunWithLoggingArgs) =>
  // When logging is enabled we have to replace the `2>&1 | tee` pipeline the
  // shell used to give us. We now pipe both streams through Effect so we can
  // mirror to the terminal (only when requested) and append formatted entries
  // into the canonical log ourselves.
  Effect.scoped(
    Effect.gen(function* () {
      const envWithColor = env.FORCE_COLOR === undefined ? { ...env, FORCE_COLOR: '1' } : env

      const prettyLoggerOptions = {
        colors: true,
        stderr: false,
        formatDate: FileLogger.formatLogTime,
      } as const

      const logStringToFile = yield* Logger.make<unknown, string>(({ message }) => {
        if (typeof message === 'string') return message
        return String(message)
      }).pipe(Logger.toFile(logPath, { flag: 'a' }), Effect.provide(NodeFileSystem.layer))

      const FileLoggerLive = Logger.layer([logStringToFile])

      const appendLog = ({ channel, content }: { channel: 'stdout' | 'stderr'; content: string }) =>
        Effect.gen(function* () {
          const date = new Date()
          const formatted = FileLogger.formatPrettyLog({
            logLevel: channel === 'stdout' ? 'Info' : 'Warn',
            message: [`[${channel}]${content.length > 0 ? ` ${content}` : ''}`],
            cause: Cause.empty,
            date,
            fiberId: 0,
            spans: [[threadName, date.getTime()]],
            annotations: { thread: threadName },
            options: prettyLoggerOptions,
          })

          yield* Effect.log(formatted.endsWith('\n') === true ? formatted.slice(0, -1) : formatted).pipe(
            Effect.provideService(References.MinimumLogLevel, 'All'),
            Effect.provide(FileLoggerLive),
          )
        })

      const command = buildCommand(commandInput, {
        cwd,
        env: envWithColor,
        stdin: 'inherit',
        stdout: 'pipe',
        stderr: 'pipe',
        shell: useShell,
      })

      // Acquire/start the command and make sure we kill it on interruption.
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const runningProcess = yield* Effect.acquireRelease(spawner.spawn(command), (proc) =>
        proc.isRunning.pipe(
          Effect.flatMap((running) =>
            running === true ? proc.kill().pipe(Effect.catch(() => Effect.void)) : Effect.void,
          ),
          Effect.ignore,
        ),
      )

      const stdoutHandler = makeStreamHandler({
        channel: 'stdout',
        ...(stdoutMode === 'inherit' ? { mirrorTarget: process.stdout } : {}),
        appendLog,
      })
      const stderrHandler = makeStreamHandler({
        channel: 'stderr',
        ...(stderrMode === 'inherit' ? { mirrorTarget: process.stderr } : {}),
        appendLog,
      })

      const stdoutFiber = yield* runningProcess.stdout.pipe(
        Stream.decodeText({ encoding: 'utf8' }),
        Stream.runForEach((chunk) => stdoutHandler.onChunk(chunk)),
        Effect.forkScoped,
      )

      const stderrFiber = yield* runningProcess.stderr.pipe(
        Stream.decodeText({ encoding: 'utf8' }),
        Stream.runForEach((chunk) => stderrHandler.onChunk(chunk)),
        Effect.forkScoped,
      )

      // Dump any buffered data and finish both stream fibers before we return.
      const flushOutputs = Effect.gen(function* () {
        const stillRunning = yield* runningProcess.isRunning.pipe(Effect.catch(() => Effect.succeed(false)))
        if (stillRunning === true) {
          yield* Effect.ignore(runningProcess.kill())
        }
        yield* Effect.ignore(Fiber.join(stdoutFiber))
        yield* Effect.ignore(Fiber.join(stderrFiber))
        yield* stdoutHandler.flush()
        yield* stderrHandler.flush()
      })

      const exitCode = yield* runningProcess.exitCode.pipe(Effect.ensuring(flushOutputs))

      return exitCode
    }),
  )

type TBuildCommandOptions = {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly stdin?: ChildProcess.CommandInput
  readonly stdout?: ChildProcess.CommandOutput
  readonly stderr?: ChildProcess.CommandOutput
  readonly shell: boolean
}

const buildCommand = (input: string | string[], options: TBuildCommandOptions): ChildProcess.Command => {
  const commandOptions = {
    cwd: options.cwd,
    env: options.env,
    extendEnv: true,
    shell: options.shell,
    ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
    ...(options.stdout !== undefined ? { stdout: options.stdout } : {}),
    ...(options.stderr !== undefined ? { stderr: options.stderr } : {}),
  } as const

  if (Array.isArray(input) === true) {
    const [c, ...a] = input
    return ChildProcess.make(c ?? '', a, commandOptions)
  }

  if (options.shell === true) {
    return ChildProcess.make(input, commandOptions)
  }

  const [c, ...a] = input.split(' ')
  return ChildProcess.make(c ?? '', a, commandOptions)
}

type TLineTerminator = 'newline' | 'carriage-return' | 'none'

type TStreamHandler = {
  readonly onChunk: (chunk: string) => Effect.Effect<void>
  readonly flush: () => Effect.Effect<void>
}

const makeStreamHandler = ({
  channel,
  mirrorTarget,
  appendLog,
}: {
  readonly channel: 'stdout' | 'stderr'
  readonly mirrorTarget?: NodeJS.WriteStream
  readonly appendLog: (args: { channel: 'stdout' | 'stderr'; content: string }) => Effect.Effect<void>
}): TStreamHandler => {
  let buffer = ''

  // Effect's FileLogger expects line-oriented messages, but the subprocess
  // gives us arbitrary UTF-8 chunks. We keep a tiny line splitter here so the
  // log and console stay readable (and consistent with the previous `tee`
  // behaviour).
  const emit = (content: string, terminator: TLineTerminator) =>
    emitSegment({
      channel,
      content,
      terminator,
      ...(mirrorTarget !== undefined ? { mirrorTarget } : {}),
      appendLog,
    })

  const consumeBuffer = (): Effect.Effect<void> => {
    if (buffer.length === 0) return Effect.void

    const lastChar = buffer[buffer.length - 1]
    if (lastChar === '\r') {
      const line = buffer.slice(0, -1)
      buffer = ''
      return emit(line, 'carriage-return')
    }

    const line = buffer
    buffer = ''
    return line.length === 0 ? Effect.void : emit(line, 'none')
  }

  return {
    onChunk: (chunk) =>
      Effect.gen(function* () {
        buffer += chunk
        while (buffer.length > 0) {
          const newlineIndex = buffer.indexOf('\n')
          const carriageIndex = buffer.indexOf('\r')

          if (newlineIndex === -1 && carriageIndex === -1) {
            break
          }

          let index: number
          let terminator: TLineTerminator
          let skip = 1

          if (carriageIndex !== -1 && (newlineIndex === -1 || carriageIndex < newlineIndex)) {
            index = carriageIndex
            if (carriageIndex + 1 < buffer.length && buffer[carriageIndex + 1] === '\n') {
              skip = 2
              terminator = 'newline'
            } else {
              terminator = 'carriage-return'
            }
          } else {
            index = newlineIndex!
            terminator = 'newline'
          }

          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + skip)
          yield* emit(line, terminator)
        }
      }),
    flush: () => consumeBuffer(),
  }
}

const emitSegment = ({
  channel,
  content,
  terminator,
  mirrorTarget,
  appendLog,
}: {
  readonly channel: 'stdout' | 'stderr'
  readonly content: string
  readonly terminator: TLineTerminator
  readonly mirrorTarget?: NodeJS.WriteStream
  readonly appendLog: (args: { channel: 'stdout' | 'stderr'; content: string }) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    if (mirrorTarget !== undefined) {
      yield* Effect.sync(() => mirrorSegment(mirrorTarget, content, terminator))
    }

    const contentForLog = terminator === 'carriage-return' ? `${content}\r` : content

    yield* appendLog({ channel, content: contentForLog })
  })

const mirrorSegment = (target: NodeJS.WriteStream, content: string, terminator: TLineTerminator) => {
  switch (terminator) {
    case 'newline': {
      target.write(`${content}\n`)
      break
    }
    case 'carriage-return': {
      target.write(`${content}\r`)
      break
    }
    case 'none': {
      target.write(content)
      break
    }
  }
}
