import fs from 'node:fs'

import { isNotUndefined, shouldNeverHappen } from '@livestore/utils'
import {
  Cause,
  Chunk,
  Command,
  type CommandExecutor,
  Effect,
  Fiber,
  FiberId,
  FiberRefs,
  HashMap,
  identity,
  List,
  LogLevel,
  type PlatformError,
  Schema,
  Sink,
  Stream,
} from '@livestore/utils/effect'
import { applyLoggingToCommand } from './cmd-log.ts'
import * as FileLogger from './FileLogger.ts'

// Branded zero value so we can compare exit codes without touching internals.
const SUCCESS_EXIT_CODE: CommandExecutor.ExitCode = 0 as CommandExecutor.ExitCode

export const cmd: (
  commandInput: string | (string | undefined)[],
  options?:
    | {
        cwd?: string
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
      }
    | undefined,
) => Effect.Effect<CommandExecutor.ExitCode, PlatformError.PlatformError | CmdError, CommandExecutor.CommandExecutor> =
  Effect.fn('cmd')(function* (commandInput, options) {
    const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')

    const asArray = Array.isArray(commandInput)
    const parts = asArray ? (commandInput as (string | undefined)[]).filter(isNotUndefined) : undefined
    const [command, ...args] = asArray ? (parts as string[]) : (commandInput as string).split(' ')

    const debugEnvStr = Object.entries(options?.env ?? {})
      .map(([key, value]) => `${key}='${value}' `)
      .join('')

    const loggingOpts = {
      ...(options?.logDir ? { logDir: options.logDir } : {}),
      ...(options?.logFileName ? { logFileName: options.logFileName } : {}),
      ...(options?.logRetention ? { logRetention: options.logRetention } : {}),
    } as const
    const { input: finalInput, subshell: needsShell, logPath } = yield* applyLoggingToCommand(commandInput, loggingOpts)

    const stdoutMode = options?.stdout ?? 'inherit'
    const stderrMode = options?.stderr ?? 'inherit'
    const useShell = (options?.shell ? true : false) || needsShell

    const commandDebugStr =
      debugEnvStr + (Array.isArray(finalInput) ? (finalInput as string[]).join(' ') : (finalInput as string))
    const subshellStr = useShell ? ' (in subshell)' : ''

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

    const exitCode = yield* isNotUndefined(logPath)
      ? Effect.gen(function* () {
          yield* Effect.sync(() => console.log(`Logging output to ${logPath}`))
          return yield* runWithLogging({ ...baseArgs, logPath, threadName: commandDebugStr })
        })
      : runWithoutLogging(baseArgs)

    if (exitCode !== SUCCESS_EXIT_CODE) {
      return yield* Effect.fail(
        CmdError.make({
          command: command!,
          args,
          cwd,
          env: options?.env ?? {},
          stderr: stderrMode,
        }),
      )
    }

    return exitCode
  })

/**
 * Runs the command with associated arguments specified by `commandInput` and
 * returns the `stdout` from the child process.
 *
 * If `options.enforceSuccess` is true, will check the command exit code prior
 * to emitting results. If the exit code is anything other than `0` (i.e. a
 * successful exit code), the `stderr` for the child process will be returned.
 */
export const cmdText: (
  commandInput: string | (string | undefined)[],
  options?: {
    cwd?: string
    stderr?: 'inherit' | 'pipe'
    runInShell?: boolean
    env?: Record<string, string | undefined>
    enforceSuccess?: boolean
  },
) => Effect.Effect<string, PlatformError.PlatformError, CommandExecutor.CommandExecutor> = Effect.fn('cmdText')(
  function* (commandInput, options) {
    const [stdout, stderr, exitCode] = yield* cmdOutput(commandInput, options)
    if (options?.enforceSuccess === true && exitCode !== 0) {
      return stderr
    }
    return stdout
  },
)

export const cmdOutput: (
  commandInput: string | (string | undefined)[],
  options?: {
    cwd?: string
    stderr?: 'inherit' | 'pipe'
    runInShell?: boolean
    env?: Record<string, string | undefined>
  },
) => Effect.Effect<
  [stdout: string, stderr: string, exitCode: CommandExecutor.ExitCode],
  PlatformError.PlatformError,
  CommandExecutor.CommandExecutor
> = Effect.fn('cmdText')(function* (commandInput, options) {
  const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
  const [command, ...args] = Array.isArray(commandInput) ? commandInput.filter(isNotUndefined) : commandInput.split(' ')
  const debugEnvStr = Object.entries(options?.env ?? {})
    .map(([key, value]) => `${key}='${value}' `)
    .join('')

  const commandDebugStr = debugEnvStr + [command, ...args].join(' ')
  const subshellStr = options?.runInShell ? ' (in subshell)' : ''

  yield* Effect.logDebug(`Running '${commandDebugStr}' in '${cwd}'${subshellStr}`)
  yield* Effect.annotateCurrentSpan({ 'span.label': commandDebugStr, command, cwd })

  const childProcess = yield* Command.make(command!, ...args).pipe(
    // inherit = Stream stderr to process.stderr, pipe = Stream stderr to process.stdout
    Command.stderr(options?.stderr ?? 'inherit'),
    Command.workingDirectory(cwd),
    options?.runInShell ? Command.runInShell(true) : identity,
    Command.env(options?.env ?? {}),
    Command.start,
  )

  const decoder = new TextDecoder('utf-8')

  const collectUint8Array = Sink.foldLeftChunks(new Uint8Array(), (bytes, chunk: Chunk.Chunk<Uint8Array>) =>
    Chunk.reduce(chunk, bytes, (acc, curr) => {
      const newArray = new Uint8Array(acc.length + curr.length)
      newArray.set(acc)
      newArray.set(curr, acc.length)
      return newArray
    }),
  )
  const readStdout = yield* childProcess.stdout.pipe(
    Stream.run(collectUint8Array),
    Effect.map((bytes) => decoder.decode(bytes)),
    Effect.forkScoped,
    Effect.withSpan("cmdText:readStdout")
  )
  const readStderr = yield* childProcess.stderr.pipe(
    Stream.run(collectUint8Array),
    Effect.map((bytes) => decoder.decode(bytes)),
    Effect.forkScoped,
    Effect.withSpan("cmdText:readStderr")
  )
  const exitCode = yield* Effect.forkScoped(childProcess.exitCode).pipe(
    Effect.withSpan("cmdText:exitCode")
  )

  return [
    yield* Fiber.await(readStdout),
    yield* Fiber.await(readStderr),
    yield* Fiber.await(exitCode),
  ]
}, Effect.scoped)

export class CmdError extends Schema.TaggedError<CmdError>()('CmdError', {
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  env: Schema.Record({ key: Schema.String, value: Schema.String.pipe(Schema.UndefinedOr) }),
  stderr: Schema.Literal('inherit', 'pipe'),
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
  buildCommand(commandInput, useShell).pipe(
    Command.stdin('inherit'),
    Command.stdout(stdoutMode),
    Command.stderr(stderrMode),
    Command.workingDirectory(cwd),
    useShell ? Command.runInShell(true) : identity,
    Command.env(env),
    Command.exitCode,
  )

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

      const logFile = yield* Effect.acquireRelease(
        Effect.sync(() => fs.openSync(logPath, 'a', 0o666)),
        (fd) => Effect.sync(() => fs.closeSync(fd)),
      )

      const prettyLogger = FileLogger.prettyLoggerTty({
        colors: true,
        stderr: false,
        formatDate: (date) => `${FileLogger.defaultDateFormat(date)} ${threadName}`,
      })

      const appendLog = ({ channel, content }: { channel: 'stdout' | 'stderr'; content: string }) =>
        Effect.sync(() => {
          const formatted = prettyLogger.log({
            fiberId: FiberId.none,
            logLevel: channel === 'stdout' ? LogLevel.Info : LogLevel.Warning,
            message: [`[${channel}]${content.length > 0 ? ` ${content}` : ''}`],
            cause: Cause.empty,
            context: FiberRefs.empty(),
            spans: List.empty(),
            annotations: HashMap.empty(),
            date: new Date(),
          })
          fs.writeSync(logFile, formatted)
        })

      const command = buildCommand(commandInput, useShell).pipe(
        Command.stdin('inherit'),
        Command.stdout('pipe'),
        Command.stderr('pipe'),
        Command.workingDirectory(cwd),
        useShell ? Command.runInShell(true) : identity,
        Command.env(envWithColor),
      )

      // Acquire/start the command and make sure we kill it on interruption.
      const runningProcess = yield* Effect.acquireRelease(command.pipe(Command.start), (proc) =>
        proc.isRunning.pipe(
          Effect.flatMap((running) => (running ? proc.kill().pipe(Effect.catchAll(() => Effect.void)) : Effect.void)),
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
        Stream.decodeText('utf8'),
        Stream.runForEach((chunk) => stdoutHandler.onChunk(chunk)),
        Effect.forkScoped,
      )

      const stderrFiber = yield* runningProcess.stderr.pipe(
        Stream.decodeText('utf8'),
        Stream.runForEach((chunk) => stderrHandler.onChunk(chunk)),
        Effect.forkScoped,
      )

      // Dump any buffered data and finish both stream fibers before we return.
      const flushOutputs = Effect.gen(function* () {
        const stillRunning = yield* runningProcess.isRunning.pipe(Effect.catchAll(() => Effect.succeed(false)))
        if (stillRunning) {
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

const buildCommand = (input: string | string[], useShell: boolean) => {
  if (Array.isArray(input)) {
    const [c, ...a] = input
    return Command.make(c!, ...a)
  }

  if (useShell) {
    return Command.make(input)
  }

  const [c, ...a] = input.split(' ')
  return Command.make(c!, ...a)
}

type TLineTerminator = 'newline' | 'carriage-return' | 'none'

type TStreamHandler = {
  readonly onChunk: (chunk: string) => Effect.Effect<void, never>
  readonly flush: () => Effect.Effect<void, never>
}

const makeStreamHandler = ({
  channel,
  mirrorTarget,
  appendLog,
}: {
  readonly channel: 'stdout' | 'stderr'
  readonly mirrorTarget?: NodeJS.WriteStream
  readonly appendLog: (args: { channel: 'stdout' | 'stderr'; content: string }) => Effect.Effect<void, never>
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
      ...(mirrorTarget ? { mirrorTarget } : {}),
      appendLog,
    })

  const consumeBuffer = (): Effect.Effect<void, never> => {
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
  readonly appendLog: (args: { channel: 'stdout' | 'stderr'; content: string }) => Effect.Effect<void, never>
}) =>
  Effect.gen(function* () {
    if (mirrorTarget) {
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
