import type * as ChildProcess from 'node:child_process'
import * as Worker from '@effect/platform/Worker'
import { WorkerError } from '@effect/platform/WorkerError'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Scope from 'effect/Scope'

// Track child processes for cleanup on process signals
const childProcesses = new Set<ChildProcess.ChildProcess>()

// Force cleanup all tracked child processes
const forceCleanupChildren = (signal: NodeJS.Signals = 'SIGKILL') => {
  for (const child of childProcesses) {
    try {
      if (!child.killed) {
        child.kill(signal)
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
  childProcesses.clear()
}

// Install signal handlers once to clean up all child processes
let signalHandlersInstalled = false

const installSignalHandlers = () => {
  if (signalHandlersInstalled) return
  signalHandlersInstalled = true

  // Use 'beforeExit' instead of signal handlers since tests may interfere with signals
  process.on('beforeExit', () => {
    forceCleanupChildren('SIGKILL')
  })

  // Also try to cleanup on uncaught exceptions
  process.on('uncaughtException', () => {
    forceCleanupChildren('SIGKILL')
  })

  // Install signal handlers but make them more robust
  const sigintHandler = () => {
    forceCleanupChildren('SIGINT')
  }

  const sigtermHandler = () => {
    forceCleanupChildren('SIGTERM')
  }

  const exitHandler = () => {
    forceCleanupChildren('SIGKILL')
  }

  // Add handlers that will persist even if tests remove/add other handlers
  process.prependListener('SIGINT', sigintHandler)
  process.prependListener('SIGTERM', sigtermHandler)
  process.prependListener('exit', exitHandler)
}

const platformWorkerImpl = Worker.makePlatform<ChildProcess.ChildProcess>()({
  setup({ scope, worker: childProcess }) {
    return Effect.flatMap(Deferred.make<void, WorkerError>(), (exitDeferred) => {
      // Install signal handlers for process-wide cleanup
      installSignalHandlers()

      // Track this child process for cleanup
      childProcesses.add(childProcess)

      childProcess.on('exit', () => {
        // Remove from tracking when process exits
        childProcesses.delete(childProcess)
        Deferred.unsafeDone(exitDeferred, Exit.void)
      })

      childProcess.send(['setup-parent-death-detection', { parentPid: process.pid }])

      return Effect.as(
        Scope.addFinalizer(
          scope,
          Effect.suspend(() => {
            // Try graceful shutdown first
            try {
              childProcess.send([1])
            } catch {
              // IPC channel might be closed, proceed to forceful termination
            }

            return Deferred.await(exitDeferred)
          }).pipe(
            Effect.timeout(3000), // Reduced timeout for faster cleanup
            Effect.interruptible,
            Effect.catchAllCause(() =>
              Effect.sync(() => {
                // Enhanced cleanup with escalating signals
                if (!childProcess.killed) {
                  try {
                    // First try SIGTERM
                    childProcess.kill('SIGTERM')

                    // If still running after a short delay, use SIGKILL
                    setTimeout(() => {
                      if (!childProcess.killed) {
                        childProcess.kill('SIGKILL')
                      }
                    }, 1000)
                  } catch {
                    // Process might already be dead
                  } finally {
                    // Ensure it's removed from tracking
                    childProcesses.delete(childProcess)
                  }
                }
              }),
            ),
          ),
        ),
        {
          postMessage: (message: any) => childProcess.send(message),
          on: (event: string, handler: (message: any) => void) => childProcess.on(event, handler),
        },
      )
    })
  },
  listen({ deferred, emit, port }) {
    port.on('message', (message) => {
      emit(message)
    })
    port.on('messageerror', (cause) => {
      Deferred.unsafeDone(deferred, new WorkerError({ reason: 'decode', cause }))
    })
    port.on('error', (cause) => {
      Deferred.unsafeDone(deferred, new WorkerError({ reason: 'unknown', cause }))
    })
    port.on('exit', (code) => {
      Deferred.unsafeDone(
        deferred,
        new WorkerError({ reason: 'unknown', cause: new Error(`exited with code ${code}`) }),
      )
    })
    return Effect.void
  },
})

export const layerWorker = Layer.succeed(Worker.PlatformWorker, platformWorkerImpl)

export const layerManager = Layer.provide(Worker.layerManager, layerWorker)

/**
 * @example
 * ```ts
 * import * as ChildProcess from 'node:child_process'
 * import { Effect, Worker } from '@effect/platform/Worker'
 * import { ChildProcessWorker } from '@livestore/utils/node'
 *
 * Worker.makePoolSerialized<WorkerMessage>({
 *   size: 1,
 *   initialMessage: () => new InitialMessage({ name: 'test', data: new Uint8Array([1, 2, 3]) }),
 * }).pipe(
 *   Effect.provide(ChildProcessWorker.layer(() => ChildProcess.fork(new URL('worker.ts', import.meta.url)))),
 * )
 * ```
 *
 */
export const layer = (spawn: (id: number) => ChildProcess.ChildProcess) =>
  Layer.merge(layerManager, Worker.layerSpawner(spawn))
