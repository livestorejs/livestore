import { error } from 'node:console'
import * as path from 'node:path'
import { IS_CI, shouldNeverHappen } from '@livestore/utils'
import {
  Command,
  Duration,
  Effect,
  Exit,
  HttpClient,
  Option,
  type PlatformError,
  Schedule,
  Schema,
  Stream,
} from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import { cleanupOrphanedProcesses, killProcessTree } from './process-tree-manager.ts'

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
  readonly processId: number
}

/**
 * Configuration for starting WranglerDevServer
 */
export interface StartWranglerDevServerArgs {
  wranglerConfigPath?: string
  cwd: string
  /** The port to try first. The dev server may bind a different port if unavailable. */
  preferredPort?: number
  /** @default false */
  showLogs?: boolean
  inspectorPort?: number
  connectTimeout?: Duration.DurationInput
}

/**
 * WranglerDevServer as an Effect.Service.
 *
 * This service provides the WranglerDevServer properties and can be accessed
 * directly to get port, url, and processId.
 *
 * TODO: Allow for config to be passed in via code instead of `wrangler.toml` file
 * (would need to be placed in temporary file as wrangler only accepts files as config)
 */
export class WranglerDevServerService extends Effect.Service<WranglerDevServerService>()('WranglerDevServerService', {
  scoped: (args: StartWranglerDevServerArgs) =>
    Effect.gen(function* () {
      const showLogs = args.showLogs ?? false

      // Clean up any orphaned processes before starting (defensive cleanup)
      yield* cleanupOrphanedProcesses(['wrangler', 'workerd']).pipe(
        Effect.tap((result) =>
          showLogs && (result.cleaned.length > 0 || result.failed.length > 0)
            ? Effect.logInfo(`Cleanup result: ${result.cleaned.length} cleaned, ${result.failed.length} failed`)
            : Effect.void,
        ),
        Effect.ignore, // Don't fail startup if cleanup fails
      )

      // Allocate preferred port (Wrangler may bind a different one if unavailable)
      const preferredPort =
        args.preferredPort ??
        (yield* getFreePort.pipe(
          Effect.mapError(
            (cause) => new WranglerDevServerError({ cause, message: 'Failed to get free port', port: -1 }),
          ),
        ))

      yield* Effect.annotateCurrentSpan({ preferredPort })

      // Resolve config path
      const configPath = path.resolve(args.wranglerConfigPath ?? path.join(args.cwd, 'wrangler.toml'))

      const inspectorPort = args.inspectorPort ?? (yield* getFreePort)

      // Start wrangler process using Effect Command
      const process = yield* Command.make(
        'bunx',
        'wrangler',
        'dev',
        '--port',
        preferredPort.toString(),
        '--inspector-port',
        inspectorPort.toString(),
        '--config',
        configPath,
      ).pipe(
        Command.workingDirectory(args.cwd),
        Command.stdout('pipe'),
        Command.stderr('pipe'),
        Command.start,
        Effect.catchAllCause(
          (error) =>
            new WranglerDevServerError({
              cause: error,
              message: `Failed to start wrangler process in directory: ${args.cwd}`,
              port: preferredPort,
            }),
        ),
        Effect.withSpan('WranglerDevServerService:startProcess'),
      )

      if (showLogs) {
        yield* process.stderr.pipe(
          Stream.decodeText('utf8'),
          Stream.tapLogWithLabel('wrangler:stderr'),
          Stream.runDrain,
          Effect.forkScoped,
        )
      }

      const processId = process.pid

      // We need to keep the `stdout` stream open, as we drain it in the waitForReady function
      // Otherwise we'll get a EPIPE error
      const stdout = yield* Stream.broadcastDynamic(process.stdout, 100)

      // Register cleanup finalizer with intelligent timeout handling
      yield* Effect.addFinalizer((exit) =>
        Effect.gen(function* () {
          const isInterrupted = Exit.isInterrupted(exit)
          if (showLogs) {
            yield* Effect.logDebug(`Cleaning up wrangler process ${processId}, interrupted: ${isInterrupted}`)
          }
          // yield* Effect.logDebug(`Cleaning up wrangler process ${processId}, interrupted: ${isInterrupted}`)

          // Check if process is still running
          const isRunning = yield* process.isRunning

          if (isRunning) {
            // Use our enhanced process tree cleanup
            yield* killProcessTree(processId, {
              timeout: isInterrupted ? 500 : 3000, // Fast cleanup on interruption
              signals: ['SIGTERM', 'SIGKILL'],
              includeRoot: true,
            }).pipe(
              Effect.tap((result) =>
                showLogs
                  ? Effect.logDebug(
                      `Cleaned up ${result.killedPids.length} processes, ${result.failedPids.length} failed`,
                    )
                  : Effect.void,
              ),
              Effect.mapError(
                (error) =>
                  new WranglerDevServerError({
                    cause: error,
                    message: `Failed to kill process tree for PID ${processId}`,
                    port: 0,
                  }),
              ),
              Effect.ignore, // Don't fail the finalizer if cleanup has issues
            )

            // Also kill the command process handle
            yield* process.kill()
          } else if (showLogs) {
            yield* Effect.logDebug(`Process ${processId} already terminated`)
          }
        }).pipe(
          Effect.withSpan('WranglerDevServerService:cleanupProcess'),
          Effect.timeout('5 seconds'), // Don't let cleanup hang forever
          Effect.ignoreLogged,
        ),
      )

      // Wait for server to be ready and parse the actual bound host:port from stdout
      const readyInfo = yield* waitForReady({ stdout, showLogs })

      const actualPort = readyInfo.port
      const actualHost = readyInfo.host
      const url = `http://${actualHost}:${actualPort}`

      // Use longer timeout in CI environments to account for slower startup times
      const defaultTimeout = Duration.seconds(IS_CI ? 30 : 5)

      yield* verifyHttpConnectivity({ url, showLogs, connectTimeout: args.connectTimeout ?? defaultTimeout })

      if (showLogs) {
        yield* Effect.logDebug(
          `Wrangler dev server ready and accepting connections on port ${actualPort} (preferred: ${preferredPort})`,
        )
      }

      return {
        port: actualPort,
        url,
        processId,
      } satisfies WranglerDevServer
    }).pipe(
      Effect.withSpan('WranglerDevServerService', {
        attributes: { preferredPort: args.preferredPort ?? 'auto', cwd: args.cwd },
      }),
    ),
}) {}

/**
 * Waits for Wrangler server to be ready by monitoring stdout for "Ready on" message
 */
const waitForReady = ({
  stdout,
  showLogs,
}: {
  stdout: Stream.Stream<Uint8Array, PlatformError.PlatformError, never>
  showLogs: boolean
}): Effect.Effect<{ host: string; port: number }, WranglerDevServerError, never> =>
  stdout.pipe(
    Stream.decodeText('utf8'),
    Stream.splitLines,
    Stream.tap((line) => (showLogs ? Effect.logDebug(`[wrangler] ${line}`) : Effect.void)),
    // Find the first readiness line and try to parse the port from it
    Stream.filterMap<string, { host: string; port: number }>((line) => {
      if (line.includes('Ready on')) {
        // Expect: "Ready on http://<host>:<port>"
        const m = line.match(/https?:\/\/([^:\s]+):(\d+)/i)
        if (!m) return shouldNeverHappen('Could not parse host:port from Wrangler "Ready on" line', line)
        const host = m[1]! as string
        const port = Number.parseInt(m[2]!, 10)
        if (!Number.isFinite(port)) return shouldNeverHappen('Parsed non-finite port from Wrangler output', line)
        return Option.some({ host, port } as const)
      } else {
        return Option.none()
      }
    }),
    Stream.take(1),
    Stream.runHead,
    Effect.flatten,
    Effect.orElse(
      () =>
        new WranglerDevServerError({
          cause: 'WranglerReadyLineMissing',
          message: 'Wrangler server did not emit a "Ready on" line',
          port: 0,
        }),
    ),
    Effect.timeoutFail({
      duration: '30 seconds',
      onTimeout: () =>
        new WranglerDevServerError({
          cause: error,
          message: 'Wrangler server failed to start within timeout',
          port: 0,
        }),
    }),
  )

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
