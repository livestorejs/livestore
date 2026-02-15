import { omitUndefineds } from '@livestore/utils'
import {
  Command,
  type CommandExecutor,
  Duration,
  Effect,
  Fiber,
  type PlatformError,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from '@livestore/utils/effect'

export class DockerComposeError extends Schema.TaggedError<DockerComposeError>()('DockerComposeError', {
  cause: Schema.Defect,
  note: Schema.String,
}) {}

export interface DockerComposeArgs {
  readonly cwd: string
  readonly serviceName?: string
  /** Unique project name to isolate this compose instance. If not provided, a random one is generated. */
  readonly projectName?: string
}

export interface StartOptions {
  readonly detached?: boolean
  readonly env?: Record<string, string>
  readonly healthCheck?: {
    readonly url: string
    readonly timeout?: Duration.Duration
    readonly interval?: Duration.Duration
  }
}

export interface LogsOptions {
  readonly follow?: boolean
  readonly tail?: number
  readonly since?: string
}

export interface DockerComposeOperations {
  readonly pull: Effect.Effect<void, DockerComposeError | PlatformError.PlatformError>
  readonly start: (
    options?: StartOptions,
  ) => Effect.Effect<void, DockerComposeError | PlatformError.PlatformError, Scope.Scope>
  readonly stop: Effect.Effect<void, DockerComposeError | PlatformError.PlatformError>
  readonly down: (options?: {
    readonly env?: Record<string, string>
    readonly volumes?: boolean
    readonly removeOrphans?: boolean
  }) => Effect.Effect<void, DockerComposeError | PlatformError.PlatformError>
  readonly logs: (
    options?: LogsOptions,
  ) => Stream.Stream<string, DockerComposeError | PlatformError.PlatformError, Scope.Scope>
  /** The unique project name used to isolate this compose instance */
  readonly projectName: string
}

const generateProjectName = (): string => `ls-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export class DockerComposeService extends Effect.Service<DockerComposeService>()('DockerComposeService', {
  scoped: (args: DockerComposeArgs) =>
    Effect.gen(function* () {
      const { cwd, serviceName } = args
      const projectName = args.projectName ?? generateProjectName()

      const commandExecutorContext = yield* Effect.context<CommandExecutor.CommandExecutor>()

      const baseComposeArgs = ['-p', projectName]

      const pull = Effect.gen(function* () {
        yield* Effect.log(`Pulling Docker Compose images in ${cwd}`)

        // TODO (@IMax153) Refactor the effect command related code below as there is probably a much more elegant way to accomplish what we want here in a more effect idiomatic way.
        const pullCommand = Command.make('docker', 'compose', ...baseComposeArgs, 'pull').pipe(
          Command.workingDirectory(cwd),
          Command.stdout('pipe'),
          Command.stderr('pipe'),
        )

        const process = yield* pullCommand.pipe(Command.start, Effect.provide(commandExecutorContext))

        const stdoutFiber = yield* process.stdout.pipe(
          Stream.decodeText('utf8'),
          Stream.runFold('', (acc, chunk) => acc + chunk),
          Effect.fork,
        )

        const stderrFiber = yield* process.stderr.pipe(
          Stream.decodeText('utf8'),
          Stream.runFold('', (acc, chunk) => acc + chunk),
          Effect.fork,
        )

        const exitCode = yield* process.exitCode
        const stdout = yield* Fiber.join(stdoutFiber)
        const stderr = yield* Fiber.join(stderrFiber)

        const exitCodeNumber = Number(exitCode)

        if (exitCodeNumber !== 0) {
          const stdoutLog = stdout.length > 0 ? stdout : '<empty stdout>'
          const stderrLog = stderr.length > 0 ? stderr : '<empty stderr>'
          const failureMessage = [
            `Docker compose pull failed with exit code ${exitCodeNumber} in ${cwd}`,
            `stdout:\n${stdoutLog}`,
            `stderr:\n${stderrLog}`,
          ].join('\n')

          yield* Effect.logError(failureMessage)

          return yield* new DockerComposeError({
            cause: new Error(`Docker compose pull failed with exit code ${exitCodeNumber}`),
            note: failureMessage,
          })
        }

        yield* Effect.log(`Successfully pulled Docker Compose images`)
      }).pipe(
        Effect.retry({
          schedule: Schedule.exponentialBackoff10Sec,
          while: Schema.is(DockerComposeError),
        }),
        Effect.withSpan('pullDockerComposeImages'),
        Effect.scoped,
      )

      const start = Effect.fn('startDockerCompose')(function* (options: StartOptions = {}) {
        const { detached = true, healthCheck } = options

        // Build start command
        const startArgs = ['docker', 'compose', ...baseComposeArgs, 'up']
        if (detached) startArgs.push('-d')
        if (serviceName) startArgs.push(serviceName)

        const command = yield* Command.make(startArgs[0]!, ...startArgs.slice(1)).pipe(
          Command.workingDirectory(cwd),
          Command.env(options.env ?? {}),
          Command.stderr('inherit'),
          Command.stdout('inherit'),
          Command.start,
          Effect.mapError(
            (cause) =>
              new DockerComposeError({
                cause,
                note: `Failed to start Docker Compose services in ${cwd}`,
              }),
          ),
          Effect.provide(commandExecutorContext),
        )

        // Wait for command completion
        yield* command.exitCode.pipe(
          Effect.flatMap((exitCode) =>
            exitCode === 0
              ? Effect.void
              : Effect.fail(
                  new DockerComposeError({
                    cause: new Error(`Docker compose exited with code ${exitCode}`),
                    note: `Docker Compose failed to start with exit code ${exitCode}. Env: ${JSON.stringify(options.env)}`,
                  }),
                ),
          ),
          Effect.provide(commandExecutorContext),
        )

        // Perform health check if requested
        if (healthCheck) {
          yield* performHealthCheck(healthCheck).pipe(Effect.provide(commandExecutorContext))
        }

        yield* Effect.log(`Docker Compose services started successfully in ${cwd}`)
      })

      const stop = Effect.gen(function* () {
        yield* Effect.log(`Stopping Docker Compose services in ${cwd}`)

        const stopCommand = serviceName
          ? Command.make('docker', 'compose', ...baseComposeArgs, 'stop', serviceName)
          : Command.make('docker', 'compose', ...baseComposeArgs, 'stop')

        yield* stopCommand.pipe(
          Command.workingDirectory(cwd),
          Command.exitCode,
          Effect.flatMap((exitCode: number) =>
            exitCode === 0
              ? Effect.void
              : Effect.fail(
                  new DockerComposeError({
                    cause: new Error(`Docker compose stop exited with code ${exitCode}`),
                    note: `Failed to stop Docker Compose services`,
                  }),
                ),
          ),
          Effect.provide(commandExecutorContext),
        )

        yield* Effect.log(`Docker Compose services stopped successfully`)
      }).pipe(Effect.withSpan('stopDockerCompose'))

      const logs = (options: LogsOptions = {}) =>
        Effect.gen(function* () {
          const { follow = false, tail, since } = options

          const logsArgs = ['docker', 'compose', ...baseComposeArgs, 'logs']
          if (follow) logsArgs.push('-f')
          if (tail) logsArgs.push('--tail', tail.toString())
          if (since) logsArgs.push('--since', since)
          if (serviceName) logsArgs.push(serviceName)

          const command = yield* Command.make(logsArgs[0]!, ...logsArgs.slice(1)).pipe(
            Command.workingDirectory(cwd),
            Command.start,
            Effect.mapError(
              (cause) =>
                new DockerComposeError({
                  cause,
                  note: `Failed to read Docker Compose logs in ${cwd}`,
                }),
            ),
            Effect.provide(commandExecutorContext),
          )

          return command.stdout.pipe(
            Stream.decodeText('utf8'),
            Stream.splitLines,
            Stream.mapError(
              (cause) =>
                new DockerComposeError({
                  cause,
                  note: `Error reading Docker Compose logs in ${cwd}`,
                }),
            ),
          )
        }).pipe(Stream.unwrapScoped)

      const down = Effect.fn('downDockerCompose')(function* (options?: {
        readonly env?: Record<string, string>
        readonly volumes?: boolean
        readonly removeOrphans?: boolean
      }) {
        yield* Effect.log(`Tearing down Docker Compose services in ${cwd}`)

        const downArgs = ['docker', 'compose', ...baseComposeArgs, 'down']
        if (options?.volumes) downArgs.push('-v')
        if (options?.removeOrphans) downArgs.push('--remove-orphans')
        if (serviceName) downArgs.push(serviceName)

        yield* Command.make(downArgs[0]!, ...downArgs.slice(1)).pipe(
          Command.workingDirectory(cwd),
          Command.env(options?.env ?? {}),
          Command.exitCode,
          Effect.flatMap((exitCode: number) =>
            exitCode === 0
              ? Effect.void
              : Effect.fail(
                  new DockerComposeError({
                    cause: new Error(`Docker compose down exited with code ${exitCode}`),
                    note: `Failed to tear down Docker Compose services`,
                  }),
                ),
          ),
          Effect.provide(commandExecutorContext),
        )

        yield* Effect.log(`Docker Compose services torn down successfully`)
      })

      // Register cleanup finalizer to ensure containers are removed when scope closes
      yield* Effect.addFinalizer(() =>
        down({ volumes: true, removeOrphans: true }).pipe(
          Effect.tap(() => Effect.log(`Docker Compose cleanup completed for project ${projectName}`)),
          Effect.catchAll((error) => Effect.log(`Docker Compose cleanup failed for project ${projectName}: ${error}`)),
        ),
      )

      return { pull, start, stop, down, logs, projectName }
    }),
}) {}

const performHealthCheck = ({
  url,
  timeout = Duration.minutes(2),
  interval = Duration.seconds(2),
}: {
  url: string
  timeout?: Duration.Duration
  interval?: Duration.Duration
}): Effect.Effect<void, DockerComposeError, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    yield* Effect.log(`Performing health check on ${url}`)

    const checkHealth = Command.make('curl', '-f', '-s', url).pipe(
      Command.exitCode,
      Effect.map((code: number) => code === 0),
      Effect.catchAll(() => Effect.succeed(false)),
    )

    const healthCheck = checkHealth.pipe(
      Effect.repeat({
        while: (healthy: boolean) => !healthy,
        schedule: Schedule.fixed(interval),
      }),
      Effect.timeout(timeout),
      Effect.mapError(
        () =>
          new DockerComposeError({
            cause: new Error('Health check timeout'),
            note: `Health check failed for ${url} after ${Duration.toMillis(timeout)}ms`,
          }),
      ),
    )

    yield* healthCheck
    yield* Effect.log(`Health check passed for ${url}`)
  })

// Convenience function for scoped Docker Compose operations with automatic cleanup
export const startDockerComposeServicesScoped = (
  args: DockerComposeArgs & {
    healthCheck?: StartOptions['healthCheck']
  },
): Effect.Effect<
  void,
  DockerComposeError | PlatformError.PlatformError,
  DockerComposeService | CommandExecutor.CommandExecutor | Scope.Scope
> =>
  Effect.gen(function* () {
    const dockerCompose = yield* DockerComposeService

    // Start the services
    yield* dockerCompose.start({
      ...omitUndefineds({ healthCheck: args.healthCheck ? args.healthCheck : undefined }),
    })

    // Add cleanup finalizer to the current scope
    yield* Effect.addFinalizer(() => dockerCompose.stop.pipe(Effect.orDie))
  })
