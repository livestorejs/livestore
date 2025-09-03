import * as path from 'node:path'

import { Command, Duration, Effect, Exit, type PlatformError, Schedule, Schema, Stream } from '@livestore/utils/effect'
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
  /** Inspector/debugger port for workerd. If not specified, uses a random free port */
  inspectorPort?: number
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
      const instanceId = Math.random().toString(36).substring(7)
      
      yield* Effect.log(`[WranglerDevServer-${instanceId}] Starting new instance`, {
        cwd: args.cwd,
        requestedPort: args.port,
        showLogs,
      })

      // Clean up any orphaned processes before starting (defensive cleanup)
      yield* cleanupOrphanedProcesses(['wrangler', 'workerd']).pipe(
        Effect.tap((result) => {
          const effects = []
          if (result.cleaned.length > 0 || result.failed.length > 0) {
            effects.push(
              Effect.logWarning(
                `[WranglerDevServer-${instanceId}] Found orphaned processes - this may indicate improper cleanup`,
                { cleaned: result.cleaned.length, failed: result.failed.length }
              )
            )
          }
          if (showLogs) {
            effects.push(
              Effect.logInfo(`Cleanup result: ${result.cleaned.length} cleaned, ${result.failed.length} failed`)
            )
          }
          return effects.length > 0 ? Effect.all(effects, { discard: true }) : Effect.void
        }),
        Effect.ignore, // Don't fail startup if cleanup fails
      )

      // Allocate port with retry logic
      let portAllocationAttempts = 0
      const maxPortAttempts = 5
      const retrySchedule = Schedule.recurs(maxPortAttempts - 1).pipe(
        Schedule.intersect(Schedule.spaced(Duration.millis(100)))
      )
      const port = args.port ?? (yield* getFreePort.pipe(
        Effect.tap((p) => {
          portAllocationAttempts++
          if (portAllocationAttempts > 1) {
            return Effect.logWarning(
              `[WranglerDevServer-${instanceId}] Port allocation attempt ${portAllocationAttempts}/${maxPortAttempts}, got port ${p}`
            )
          }
          return Effect.void
        }),
        Effect.mapError(
          (cause) => new WranglerDevServerError({ cause, message: 'Failed to get free port', port: -1 }),
        ),
        Effect.retry(retrySchedule)
      ))

      // Allocate inspector port if not provided  
      let inspectorPortAttempts = 0
      const inspectorPort = args.inspectorPort ?? (yield* getFreePort.pipe(
        Effect.tap((p) => {
          inspectorPortAttempts++
          if (inspectorPortAttempts > 1) {
            return Effect.logWarning(
              `[WranglerDevServer-${instanceId}] Inspector port allocation attempt ${inspectorPortAttempts}/${maxPortAttempts}, got port ${p}`
            )
          }
          return Effect.void
        }),
        Effect.mapError(
          (cause) => new WranglerDevServerError({ cause, message: 'Failed to get free inspector port', port: -1 }),
        ),
        Effect.retry(retrySchedule)
      ))

      yield* Effect.annotateCurrentSpan({ port, inspectorPort, instanceId })
      
      yield* Effect.log(`[WranglerDevServer-${instanceId}] Allocated ports`, { 
        port, 
        inspectorPort,
        portAttempts: portAllocationAttempts,
        inspectorPortAttempts
      })

      // Resolve config path
      const configPath = path.resolve(args.wranglerConfigPath ?? path.join(args.cwd, 'wrangler.toml'))

      // Start wrangler process using Effect Command
      // In CI, disable the inspector to avoid port conflicts
      const commandArgs: string[] = ['bunx', 'wrangler', 'dev', '--port', port.toString()]

      // Only add inspector port if not in CI to avoid conflicts
      // Use global process from Node.js
      if (!global.process.env.CI) {
        commandArgs.push('--inspector-port', inspectorPort.toString())
        yield* Effect.log(`[WranglerDevServer-${instanceId}] Inspector enabled on port ${inspectorPort}`)
      } else {
        yield* Effect.log(`[WranglerDevServer-${instanceId}] Inspector disabled in CI environment`)
      }

      commandArgs.push('--config', configPath)

      yield* Effect.log(`[WranglerDevServer-${instanceId}] Starting wrangler process`, {
        command: commandArgs.join(' '),
        cwd: args.cwd
      })

      const process = yield* Command.make(...(commandArgs as [string, ...string[]])).pipe(
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

      const processId = process.pid
      
      yield* Effect.log(`[WranglerDevServer-${instanceId}] Process created`, {
        processId,
        port,
        inspectorPort
      })

      if (showLogs) {
        yield* process.stderr.pipe(
          Stream.decodeText('utf8'),
          Stream.tapLogWithLabel(`[WranglerDevServer-${instanceId}] stderr`),
          Stream.runDrain,
          Effect.forkScoped,
        )
      }

      // We need to keep the `stdout` stream open, as we drain it in the waitForReady function
      // Otherwise we'll get a EPIPE error
      const stdout = yield* Stream.broadcastDynamic(process.stdout, 100)

      // Register cleanup finalizer with intelligent timeout handling
      yield* Effect.addFinalizer((exit) =>
        Effect.gen(function* () {
          const isInterrupted = Exit.isInterrupted(exit)
          
          yield* Effect.log(`[WranglerDevServer-${instanceId}] Finalizer called`, {
            processId,
            port,
            isInterrupted,
            exitType: Exit.isFailure(exit) ? 'failure' : 'success'
          })
          
          if (showLogs) {
            yield* Effect.logDebug(`Cleaning up wrangler process ${processId}, interrupted: ${isInterrupted}`)
          }

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
      yield* Effect.log(`[WranglerDevServer-${instanceId}] Waiting for server to be ready`)
      yield* waitForReady({ stdout, showLogs, instanceId })

      yield* Effect.log(`[WranglerDevServer-${instanceId}] Server ready`, {
        port,
        url: `http://localhost:${port}`,
        processId
      })
      
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
  instanceId = 'unknown',
}: {
  stdout: Stream.Stream<Uint8Array, PlatformError.PlatformError, never>
  showLogs: boolean
  instanceId?: string
}): Effect.Effect<void, WranglerDevServerError, never> =>
  stdout.pipe(
    Stream.decodeText('utf8'),
    Stream.splitLines,
    Stream.tap((line) => {
      if (line.includes('Ready on')) {
        return Effect.log(`[WranglerDevServer-${instanceId}] Found ready signal: ${line}`)
      }
      return showLogs ? Effect.logDebug(`[WranglerDevServer-${instanceId}] ${line}`) : Effect.void
    }),
    Stream.takeUntil((line) => line.includes('Ready on')),
    Stream.runDrain,
    Effect.timeout('30 seconds'),
    Effect.mapError(
      (error) =>
        new WranglerDevServerError({
          cause: error,
          message: `[WranglerDevServer-${instanceId}] Server failed to start within timeout`,
          port: 0,
        }),
    ),
  )
