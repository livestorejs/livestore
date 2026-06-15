import { objectToString, omitUndefineds } from '@livestore/utils'
import {
  ChildProcess,
  type ChildProcessSpawner,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  type PlatformError,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from '@livestore/utils/effect'

export class DockerComposeError extends Schema.TaggedErrorClass<DockerComposeError>(
  '~@livestore/utils-dev/DockerComposeError',
)('DockerComposeError', {
  cause: Schema.Defect(),
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

export class DockerComposeService extends Context.Service<DockerComposeService, DockerComposeOperations>()(
  'DockerComposeService',
) {
  static readonly layer = (args: DockerComposeArgs) =>
    Layer.effect(DockerComposeService, makeDockerComposeOperations(args))
}

const makeDockerComposeOperations = (
  args: DockerComposeArgs,
): Effect.Effect<
  DockerComposeOperations,
  DockerComposeError | PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const { cwd, serviceName } = args
    const projectName = args.projectName ?? generateProjectName()

    const commandExecutorContext = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>()

    const baseComposeArgs = ['-p', projectName]

    const dockerCommand = (args: readonly string[], options: ChildProcess.CommandOptions = {}) =>
      ChildProcess.make(args[0]!, args.slice(1), {
        cwd,
        extendEnv: true,
        ...options,
      })

    const startProcess = (command: ChildProcess.Command) => command.pipe(Effect.provide(commandExecutorContext))

    const runExitCode = (command: ChildProcess.Command) =>
      Effect.scoped(Effect.flatMap(startProcess(command), (childProcess) => childProcess.exitCode))

    const pull = Effect.gen(function* () {
      yield* Effect.log(`Pulling Docker Compose images in ${cwd}`)

      // TODO (@IMax153) Refactor the effect command related code below as there is probably a much more elegant way to accomplish what we want here in a more effect idiomatic way.
      const pullCommand = dockerCommand(['docker', 'compose', ...baseComposeArgs, 'pull'], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const process = yield* startProcess(pullCommand)

      const stdoutFiber = yield* process.stdout.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => '',
          (acc, chunk) => acc + chunk,
        ),
        Effect.forkChild,
      )

      const stderrFiber = yield* process.stderr.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => '',
          (acc, chunk) => acc + chunk,
        ),
        Effect.forkChild,
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
      if (detached === true) startArgs.push('-d')
      if (serviceName !== undefined) startArgs.push(serviceName)

      const command = yield* startProcess(
        dockerCommand(startArgs, {
          env: options.env ?? {},
          stderr: 'inherit',
          stdout: 'inherit',
        }),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new DockerComposeError({
              cause,
              note: `Failed to start Docker Compose services in ${cwd}`,
            }),
        ),
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
      )

      // Perform health check if requested
      if (healthCheck !== undefined) {
        yield* performHealthCheck(healthCheck).pipe(Effect.provide(commandExecutorContext))
      }

      yield* Effect.log(`Docker Compose services started successfully in ${cwd}`)
    })

    const stop = Effect.gen(function* () {
      yield* Effect.log(`Stopping Docker Compose services in ${cwd}`)

      const stopCommand = dockerCommand(
        serviceName !== undefined
          ? ['docker', 'compose', ...baseComposeArgs, 'stop', serviceName]
          : ['docker', 'compose', ...baseComposeArgs, 'stop'],
      )

      yield* runExitCode(stopCommand).pipe(
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
      )

      yield* Effect.log(`Docker Compose services stopped successfully`)
    }).pipe(Effect.withSpan('stopDockerCompose'))

    const logs = (options: LogsOptions = {}) =>
      Effect.gen(function* () {
        const { follow = false, tail, since } = options

        const logsArgs = ['docker', 'compose', ...baseComposeArgs, 'logs']
        if (follow === true) logsArgs.push('-f')
        if (tail !== undefined) logsArgs.push('--tail', tail.toString())
        if (since !== undefined) logsArgs.push('--since', since)
        if (serviceName !== undefined) logsArgs.push(serviceName)

        const command = yield* startProcess(dockerCommand(logsArgs, { stdout: 'pipe' })).pipe(
          Effect.mapError(
            (cause) =>
              new DockerComposeError({
                cause,
                note: `Failed to read Docker Compose logs in ${cwd}`,
              }),
          ),
        )

        return command.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.mapError(
            (cause) =>
              new DockerComposeError({
                cause,
                note: `Error reading Docker Compose logs in ${cwd}`,
              }),
          ),
        )
      }).pipe(Stream.unwrap)

    const down = Effect.fn('downDockerCompose')(function* (options?: {
      readonly env?: Record<string, string>
      readonly volumes?: boolean
      readonly removeOrphans?: boolean
    }) {
      yield* Effect.log(`Tearing down Docker Compose services in ${cwd}`)

      const downArgs = ['docker', 'compose', ...baseComposeArgs, 'down']
      if (options?.volumes === true) downArgs.push('-v')
      if (options?.removeOrphans === true) downArgs.push('--remove-orphans')

      yield* runExitCode(
        dockerCommand(downArgs, {
          env: options?.env ?? {},
        }),
      ).pipe(
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
      )

      yield* Effect.log(`Docker Compose services torn down successfully`)
    })

    // Register cleanup finalizer to ensure containers are removed when scope closes
    yield* Effect.addFinalizer(() =>
      down({ volumes: true, removeOrphans: true }).pipe(
        Effect.tap(() => Effect.log(`Docker Compose cleanup completed for project ${projectName}`)),
        Effect.catch((error) =>
          Effect.log('Docker Compose cleanup failed for project', projectName, objectToString(error)),
        ),
      ),
    )

    return { pull, start, stop, down, logs, projectName }
  })

const performHealthCheck = ({
  url,
  timeout = Duration.minutes(2),
  interval = Duration.seconds(2),
}: {
  url: string
  timeout?: Duration.Duration
  interval?: Duration.Duration
}): Effect.Effect<void, DockerComposeError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function* () {
    yield* Effect.log(`Performing health check on ${url}`)

    const checkHealth = runScopedExitCode(ChildProcess.make('curl', ['-f', '-s', url])).pipe(
      Effect.map((code: number) => code === 0),
      Effect.catch(() => Effect.succeed(false)),
    )

    const healthCheck = checkHealth.pipe(
      Effect.repeat({
        while: (healthy: boolean) => healthy === false,
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

const runScopedExitCode = (command: ChildProcess.Command) =>
  Effect.scoped(Effect.flatMap(command, (childProcess) => childProcess.exitCode))

// Convenience function for scoped Docker Compose operations with automatic cleanup
export const startDockerComposeServicesScoped = (
  args: DockerComposeArgs & {
    healthCheck?: StartOptions['healthCheck']
  },
): Effect.Effect<
  void,
  DockerComposeError | PlatformError.PlatformError,
  DockerComposeService | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const dockerCompose = yield* DockerComposeService

    // Start the services
    yield* dockerCompose.start({
      ...omitUndefineds({ healthCheck: args.healthCheck !== undefined ? args.healthCheck : undefined }),
    })

    // Add cleanup finalizer to the current scope
    yield* Effect.addFinalizer(() => dockerCompose.stop.pipe(Effect.orDie))
  })
