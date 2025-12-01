import * as path from 'node:path'
import * as Toml from '@iarna/toml'
import { IS_CI } from '@livestore/utils'
import { Cause, Duration, Effect, FileSystem, HttpClient, Schedule, Schema } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import * as wrangler from 'wrangler'

/**
 * Error type for WranglerDevServer operations
 */
export class WranglerDevServerError extends Schema.TaggedError<WranglerDevServerError>()('WranglerDevServerError', {
  cause: Schema.Unknown,
  message: Schema.String,
  port: Schema.Number,
}) {}

/**
 * WranglerDevServer instance interface
 */
export interface WranglerDevServer {
  readonly port: number
  readonly url: string
  // readonly processId: number
}

/**
 * Readiness and retry configuration for wrangler boot and HTTP health.
 *
 * Example: startupTimeout=20s, connectTimeout=5s, retrySchedule=recurs(1)
 * - Give wrangler up to 20s to boot; if it succeeds, give the HTTP check up to 5s.
 * - If wrangler fails/times out, retry boot once; each boot attempt gets its own 20s budget.
 * connectTimeout should be shorter than startupTimeout because HTTP readiness should be fast after boot.
 */
export interface WranglerReadinessOptions {
  /** Max time to wait for wrangler to report ready before retrying. */
  startupTimeout?: Duration.DurationInput
  /** Max time for the HTTP connectivity check after wrangler reports ready. */
  connectTimeout?: Duration.DurationInput
  /** Retry policy for startup attempts (applies when startupTimeout elapses or wrangler throws). */
  retrySchedule?: Schedule.Schedule<unknown, unknown, never>
}

export interface StartWranglerDevServerArgs {
  /** Path to wrangler.toml (defaults to cwd/wrangler.toml). */
  wranglerConfigPath?: string
  /** Working directory wrangler should use. */
  cwd: string
  /** The port to try first. The dev server may bind a different port if unavailable. */
  preferredPort?: number
  /** @default false */
  showLogs?: boolean
  /** Optional inspector port for wrangler dev. */
  inspectorPort?: number
  /** Readiness and retry configuration for bringing up wrangler and confirming connectivity. */
  readiness?: WranglerReadinessOptions
}

/**
 * WranglerDevServer as an Effect.Service.
 *
 * This service provides the WranglerDevServer properties and can be accessed
 * directly to get port and url.
 *
 * TODO: Allow for config to be passed in via code instead of `wrangler.toml` file
 * (would need to be placed in temporary file as wrangler only accepts files as config)
 */
export class WranglerDevServerService extends Effect.Service<WranglerDevServerService>()('WranglerDevServerService', {
  scoped: (args: StartWranglerDevServerArgs) =>
    Effect.gen(function* () {
      const showLogs = args.showLogs ?? false

      // Allocate preferred port (Wrangler may bind a different one if unavailable)
      const preferredPort =
        args.preferredPort ??
        (yield* getFreePort.pipe(
          Effect.mapError(
            (cause) => new WranglerDevServerError({ cause, message: 'Failed to get free port', port: -1 }),
          ),
        ))

      yield* Effect.annotateCurrentSpan({ preferredPort })

      const configPath = path.resolve(args.wranglerConfigPath ?? path.join(args.cwd, 'wrangler.toml'))

      const fs = yield* FileSystem.FileSystem
      const configContent = yield* fs.readFileString(configPath)
      const parsedConfig = yield* Effect.try(() => Toml.parse(configContent)).pipe(
        Effect.andThen(Schema.decodeUnknown(Schema.Struct({ main: Schema.String }))),
        Effect.mapError(
          (error) => new WranglerDevServerError({ cause: error, message: 'Failed to parse wrangler config', port: -1 }),
        ),
      )
      const resolvedMainPath = yield* Effect.try(() => path.resolve(args.cwd, parsedConfig.main))

      const readiness = args.readiness ?? {}
      const startupTimeout = readiness.startupTimeout ?? Duration.seconds(IS_CI ? 30 : 10)
      const devServer = yield* Effect.promise(() =>
        wrangler.unstable_dev(resolvedMainPath, {
          config: configPath,
          port: preferredPort,
          inspectorPort: args.inspectorPort ?? 0,
          persistTo: path.join(args.cwd, '.wrangler/state'),
          logLevel: showLogs ? 'debug' : 'none',
          experimental: {
            disableExperimentalWarning: true,
          },
        }),
      ).pipe(
        Effect.timeout(startupTimeout),
        Effect.mapError(
          (cause) =>
            new WranglerDevServerError({
              cause,
              message: `Failed to start wrangler dev server within ${Duration.format(startupTimeout)}`,
              port: preferredPort,
            }),
        ),
        Effect.tapError((error) =>
          Effect.logError('Wrangler dev server failed to start', {
            message: error.message,
            preferredPort,
            cwd: args.cwd,
          }),
        ),
        Effect.retry(readiness.retrySchedule ?? Schedule.recurs(1)),
      )

      yield* Effect.addFinalizer(
        Effect.fn(
          function* (exit) {
            if (exit._tag === 'Failure' && Cause.isInterruptedOnly(exit.cause) === false) {
              yield* Effect.logError('Closing wrangler dev server on failure', exit.cause)
            }

            yield* Effect.tryPromise(async () => {
              await devServer.stop()
              // TODO investigate whether we need to wait until exit (see workers-sdk repo/talk to Cloudflare team)
              // await devServer.waitUntilExit()
            })
          },
          Effect.timeout('5 seconds'),
          Effect.orDie,
          Effect.tapCauseLogPretty,
          Effect.withSpan('WranglerDevServerService:stopDevServer'),
        ),
      )

      const actualPort = devServer.port
      const actualHost = devServer.address
      const url = `http://${actualHost}:${actualPort}`

      // Use longer timeout in CI environments to account for slower HTTP readiness
      const defaultConnectivityTimeout = Duration.seconds(IS_CI ? 30 : 5)
      const connectivityTimeout = readiness.connectTimeout ?? defaultConnectivityTimeout

      yield* verifyHttpConnectivity({ url, showLogs, connectTimeout: connectivityTimeout })

      if (showLogs) {
        yield* Effect.logDebug(
          `Wrangler dev server ready and accepting connections on port ${actualPort} (preferred: ${preferredPort})`,
        )
      }

      return {
        port: actualPort,
        url,
      } satisfies WranglerDevServer
    }).pipe(
      Effect.mapError((error) =>
        error instanceof WranglerDevServerError
          ? error
          : new WranglerDevServerError({ cause: error, message: 'Failed to start wrangler dev server', port: -1 }),
      ),
      Effect.withSpan('WranglerDevServerService', {
        attributes: { preferredPort: args.preferredPort ?? 'auto', cwd: args.cwd },
      }),
    ),
}) {}

/**
 * Verifies the server is actually accepting HTTP connections by making a test request
 */
const verifyHttpConnectivity = ({
  url,
  showLogs,
  connectTimeout,
}: {
  url: string
  showLogs: boolean
  connectTimeout: Duration.DurationInput
}): Effect.Effect<void, WranglerDevServerError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    if (showLogs) {
      yield* Effect.logDebug(`Verifying HTTP connectivity to ${url}`)
    }

    // Try to connect with retries using exponential backoff
    yield* client.get(url).pipe(
      Effect.retryOrElse(
        Schedule.exponential('50 millis', 2).pipe(
          Schedule.jittered,
          Schedule.intersect(Schedule.elapsed.pipe(Schedule.whileOutput(Duration.lessThanOrEqualTo(connectTimeout)))),
          Schedule.compose(Schedule.count),
        ),
        (error, attemptCount) =>
          Effect.fail(
            new WranglerDevServerError({
              cause: error,
              message: `Failed to establish HTTP connection to Wrangler server at ${url} after ${attemptCount} attempts (timeout: ${Duration.toMillis(connectTimeout)}ms)`,
              port: 0,
            }),
          ),
      ),
      Effect.tap(() => (showLogs ? Effect.logDebug(`HTTP connectivity verified for ${url}`) : Effect.void)),
      Effect.asVoid,
      Effect.withSpan('verifyHttpConnectivity'),
    )
  })
