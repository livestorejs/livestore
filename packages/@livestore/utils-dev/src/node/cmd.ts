import { isNotUndefined, shouldNeverHappen } from '@livestore/utils'
import { Command, type CommandExecutor, Effect, identity, type PlatformError, Schema } from '@livestore/utils/effect'

export const cmd: (
  commandInput: string | (string | undefined)[],
  options?:
    | {
        cwd?: string
        stderr?: 'inherit' | 'pipe'
        stdout?: 'inherit' | 'pipe'
        shell?: boolean
        env?: Record<string, string | undefined>
      }
    | undefined,
) => Effect.Effect<CommandExecutor.ExitCode, PlatformError.PlatformError | CmdError, CommandExecutor.CommandExecutor> =
  Effect.fn('cmd')(function* (commandInput, options) {
    const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
    const [command, ...args] = Array.isArray(commandInput)
      ? commandInput.filter(isNotUndefined)
      : commandInput.split(' ')

    const debugEnvStr = Object.entries(options?.env ?? {})
      .map(([key, value]) => `${key}='${value}' `)
      .join('')
    const subshellStr = options?.shell ? ' (in subshell)' : ''
    const commandDebugStr = debugEnvStr + [command, ...args].join(' ')

    yield* Effect.logDebug(`Running '${commandDebugStr}' in '${cwd}'${subshellStr}`)
    yield* Effect.annotateCurrentSpan({ 'span.label': commandDebugStr, cwd, command, args })

    return yield* Command.make(command!, ...args).pipe(
      // TODO don't forward abort signal to the command
      Command.stdin('inherit'), // Forward stdin to the command
      // inherit = Stream stdout to process.stdout, pipe = Stream stdout to process.stderr
      Command.stdout(options?.stdout ?? 'inherit'),
      // inherit = Stream stderr to process.stderr, pipe = Stream stderr to process.stdout
      Command.stderr(options?.stderr ?? 'inherit'),
      Command.workingDirectory(cwd),
      options?.shell ? Command.runInShell(true) : identity,
      Command.env(options?.env ?? {}),
      Command.exitCode,
      Effect.tap((exitCode) =>
        exitCode === 0
          ? Effect.void
          : Effect.fail(
              CmdError.make({
                command: command!,
                args,
                cwd,
                env: options?.env ?? {},
                stderr: options?.stderr ?? 'inherit',
              }),
            ),
      ),
    )
  })

export const cmdText: (
  commandInput: string | (string | undefined)[],
  options?: {
    cwd?: string
    stderr?: 'inherit' | 'pipe'
    runInShell?: boolean
    env?: Record<string, string | undefined>
  },
) => Effect.Effect<string, PlatformError.PlatformError, CommandExecutor.CommandExecutor> = Effect.fn('cmdText')(
  function* (commandInput, options) {
    const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
    const [command, ...args] = Array.isArray(commandInput)
      ? commandInput.filter(isNotUndefined)
      : commandInput.split(' ')
    const debugEnvStr = Object.entries(options?.env ?? {})
      .map(([key, value]) => `${key}='${value}' `)
      .join('')

    const commandDebugStr = debugEnvStr + [command, ...args].join(' ')
    const subshellStr = options?.runInShell ? ' (in subshell)' : ''

    yield* Effect.logDebug(`Running '${commandDebugStr}' in '${cwd}'${subshellStr}`)
    yield* Effect.annotateCurrentSpan({ 'span.label': commandDebugStr, command, cwd })

    return yield* Command.make(command!, ...args).pipe(
      // inherit = Stream stderr to process.stderr, pipe = Stream stderr to process.stdout
      Command.stderr(options?.stderr ?? 'inherit'),
      Command.workingDirectory(cwd),
      options?.runInShell ? Command.runInShell(true) : identity,
      Command.env(options?.env ?? {}),
      Command.string,
    )
  },
)

export class CmdError extends Schema.TaggedError<CmdError>()('CmdError', {
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  env: Schema.Record({ key: Schema.String, value: Schema.String.pipe(Schema.UndefinedOr) }),
  stderr: Schema.Literal('inherit', 'pipe'),
}) {}
