import * as path from 'node:path'

import { Command, Effect, Exit, type PlatformError, Schema, Stream } from '@livestore/utils/effect'
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
  port?: number
  /** @default false */
  showLogs?: boolean
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

      // Allocate port
      const port =
        args.port ??
        (yield* getFreePort.pipe(
          Effect.mapError(
            (cause) => new WranglerDevServerError({ cause, message: 'Failed to get free port', port: -1 }),
          ),
        ))

      yield* Effect.annotateCurrentSpan({ port })

      // Resolve config path
      const configPath = path.resolve(args.wranglerConfigPath ?? path.join(args.cwd, 'wrangler.toml'))

      // Start wrangler process using Effect Command
      const process = yield* Command.make(
        'bunx',
        'wrangler',
        'dev',
        '--port',
        port.toString(),
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
              port,
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
          Effect.timeout('5 seconds'), // Don't let cleanup hang forever
          Effect.ignoreLogged,
        ),
      )

      // Wait for server to be ready
      yield* waitForReady({ stdout, showLogs })

      if (showLogs) {
        yield* Effect.logDebug(`Wrangler dev server ready on port ${port}`)
      }

      return {
        port,
        url: `http://localhost:${port}`,
        processId,
      } satisfies WranglerDevServer
    }).pipe(
      Effect.withSpan('WranglerDevServerService', {
        attributes: { port: args.port ?? 'auto', cwd: args.cwd },
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
}): Effect.Effect<void, WranglerDevServerError, never> =>
  stdout.pipe(
    Stream.decodeText('utf8'),
    Stream.splitLines,
    Stream.tap((line) => (showLogs ? Effect.logDebug(`[wrangler] ${line}`) : Effect.void)),
    Stream.takeUntil((line) => line.includes('Ready on')),
    Stream.runDrain,
    Effect.timeout('30 seconds'),
    Effect.mapError(
      (error) =>
        new WranglerDevServerError({
          cause: error,
          message: 'Wrangler server failed to start within timeout',
          port: 0,
        }),
    ),
  )
