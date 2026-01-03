import { isNotUndefined } from '@livestore/utils'
import {
  Cause,
  Command,
  type CommandExecutor,
  Effect,
  Fiber,
  type PlatformError,
  Stream,
} from '@livestore/utils/effect'
import { CmdError, CurrentWorkingDirectory } from '@livestore/utils-dev/node'

import { CheckEventPubSub, type CheckType } from './events.ts'

const SUCCESS_EXIT_CODE: CommandExecutor.ExitCode = 0 as CommandExecutor.ExitCode

/**
 * Run a command and publish its output to the CheckEventPubSub.
 * Output is captured line-by-line and published as CheckOutput events.
 */
export const runCommandWithEvents = (
  check: CheckType,
  name: string,
  commandInput: string | (string | undefined)[],
  options?: {
    shell?: boolean
    env?: Record<string, string | undefined>
  },
): Effect.Effect<
  void,
  PlatformError.PlatformError | CmdError,
  CommandExecutor.CommandExecutor | CurrentWorkingDirectory | CheckEventPubSub
> =>
  Effect.gen(function* () {
    const cwd = yield* CurrentWorkingDirectory
    const _pubsub = yield* CheckEventPubSub

    const parts = Array.isArray(commandInput)
      ? (commandInput as (string | undefined)[]).filter(isNotUndefined)
      : undefined
    const [command, ...args] = parts ?? (commandInput as string).split(' ')

    const useShell = options?.shell ?? false
    const env = options?.env ?? {}

    const envWithColor = env.FORCE_COLOR === undefined ? { ...env, FORCE_COLOR: '1' } : env

    const builtCommand = Array.isArray(commandInput)
      ? Command.make(command!, ...args)
      : useShell
        ? Command.make(commandInput as string)
        : Command.make(command!, ...args)

    const fullCommand = builtCommand.pipe(
      Command.stdin('inherit'),
      Command.stdout('pipe'),
      Command.stderr('pipe'),
      Command.workingDirectory(cwd),
      useShell ? Command.runInShell(true) : (x) => x,
      Command.env(envWithColor),
    )

    // Start the process
    const proc = yield* Effect.acquireRelease(fullCommand.pipe(Command.start), (p) =>
      p.isRunning.pipe(
        Effect.flatMap((running) => (running ? p.kill().pipe(Effect.catchAll(() => Effect.void)) : Effect.void)),
        Effect.ignore,
      ),
    )

    // Helper to publish lines from a stream
    const processStream = (
      stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
      channel: 'stdout' | 'stderr',
    ) =>
      stream.pipe(
        Stream.decodeText('utf8'),
        Stream.splitLines,
        Stream.runForEach((line) => CheckEventPubSub.publishOutput(check, name, channel, line)),
      )

    // Process stdout and stderr in parallel
    const stdoutFiber = yield* processStream(proc.stdout, 'stdout').pipe(Effect.forkScoped)
    const stderrFiber = yield* processStream(proc.stderr, 'stderr').pipe(Effect.forkScoped)

    // Wait for process to exit and streams to finish
    const exitCode = yield* proc.exitCode
    yield* Fiber.join(stdoutFiber)
    yield* Fiber.join(stderrFiber)

    if (exitCode !== SUCCESS_EXIT_CODE) {
      return yield* Effect.fail(
        CmdError.make({
          command: command!,
          args,
          cwd,
          env: options?.env ?? {},
          stderr: 'pipe',
        }),
      )
    }
  }).pipe(Effect.scoped)

/**
 * Run a check with timing and event publishing.
 * Publishes Started, Output (via runCommandWithEvents), and Completed/Failed events.
 */
export const runCheckWithEvents = <E, R>(
  check: CheckType,
  name: string,
  effect: Effect.Effect<void, E, R>,
): Effect.Effect<boolean, never, R | CheckEventPubSub> =>
  Effect.gen(function* () {
    const startTime = Date.now()

    yield* CheckEventPubSub.publishStarted(check, name)

    const result = yield* effect.pipe(Effect.either)

    const durationMs = Date.now() - startTime

    if (result._tag === 'Right') {
      yield* CheckEventPubSub.publishCompleted(check, name, true, durationMs)
      return true
    } else {
      const error = result.left
      const errorMessage = Cause.pretty(Cause.fail(error))
      yield* CheckEventPubSub.publishFailed(check, name, errorMessage)
      yield* CheckEventPubSub.publishCompleted(check, name, false, durationMs)
      return false
    }
  })
