import { omitUndefineds } from '@livestore/utils'
import {
  Command,
  type CommandExecutor,
  Duration,
  Effect,
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
  readonly logs: (
    options?: LogsOptions,
  ) => Stream.Stream<string, DockerComposeError | PlatformError.PlatformError, Scope.Scope>
}

export class DockerComposeService extends Effect.Service<DockerComposeService>()('DockerComposeService', {
  scoped: (args: DockerComposeArgs) =>
    Effect.gen(function* () {
      const { cwd, serviceName } = args

      const commandExecutorContext = yield* Effect.context<CommandExecutor.CommandExecutor>()

      const pull = Effect.gen(function* () {
        yield* Effect.log(`Pulling Docker Compose images in ${cwd}`)

        yield* Command.make('docker', 'compose', 'pull').pipe(
          Command.workingDirectory(cwd),
          Command.exitCode,
          Effect.flatMap((exitCode: number) =>
            exitCode === 0
              ? Effect.void
              : Effect.fail(
                  new DockerComposeError({
                    cause: new Error(`Docker compose pull failed with exit code ${exitCode}`),
                    note: `Docker compose pull failed with exit code ${exitCode}`,
                  }),
                ),
          ),
          Effect.provide(commandExecutorContext),
        )

        yield* Effect.log(`Successfully pulled Docker Compose images`)
      }).pipe(Effect.withSpan('pullDockerComposeImages'))

      const start = (options: StartOptions = {}) =>
        Effect.gen(function* () {
          const { detached = true, healthCheck } = options

          // Build start command
          const baseArgs = ['docker', 'compose', 'up']
          if (detached) baseArgs.push('-d')
          if (serviceName) baseArgs.push(serviceName)

          const command = yield* Command.make(baseArgs[0]!, ...baseArgs.slice(1)).pipe(
            Command.workingDirectory(cwd),
            Command.env(options.env ?? {}),
            Command.start,
            Effect.catchAll((cause) =>
              Effect.fail(
                new DockerComposeError({
                  cause,
                  note: `Failed to start Docker Compose services in ${cwd}`,
                }),
              ),
            ),
            Effect.provide(commandExecutorContext),
          )

          // Wait for command completion
          yield* command.exitCode.pipe(
            Effect.flatMap((exitCode: number) =>
              exitCode === 0
                ? Effect.void
                : Effect.fail(
                    new DockerComposeError({
                      cause: new Error(`Docker compose exited with code ${exitCode}`),
                      note: `Docker Compose failed to start with exit code ${exitCode}`,
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
        }).pipe(Effect.withSpan('startDockerCompose'))

      const stop = Effect.gen(function* () {
        yield* Effect.log(`Stopping Docker Compose services in ${cwd}`)

        const stopCommand = serviceName
          ? Command.make('docker', 'compose', 'stop', serviceName)
          : Command.make('docker', 'compose', 'stop')

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

          const baseArgs = ['docker', 'compose', 'logs']
          if (follow) baseArgs.push('-f')
          if (tail) baseArgs.push('--tail', tail.toString())
          if (since) baseArgs.push('--since', since)
          if (serviceName) baseArgs.push(serviceName)

          const command = yield* Command.make(baseArgs[0]!, ...baseArgs.slice(1)).pipe(
            Command.workingDirectory(cwd),
            Command.start,
            Effect.catchAll((cause) =>
              Effect.fail(
                new DockerComposeError({
                  cause,
                  note: `Failed to read Docker Compose logs in ${cwd}`,
                }),
              ),
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

      return { pull, start, stop, logs }
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
      Effect.catchAll(() =>
        Effect.fail(
          new DockerComposeError({
            cause: new Error('Health check timeout'),
            note: `Health check failed for ${url} after ${Duration.toMillis(timeout)}ms`,
          }),
        ),
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
