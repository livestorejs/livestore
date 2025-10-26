import process from 'node:process'

import { WorkerError } from '@effect/platform/WorkerError'
import type { CloseLatch } from '@effect/platform/WorkerRunner'
import * as Runner from '@effect/platform/WorkerRunner'
import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FiberSet from 'effect/FiberSet'
import * as Layer from 'effect/Layer'
import * as Runtime from 'effect/Runtime'
import * as Scope from 'effect/Scope'

// Parent death monitoring setup
let parentDeathDetectionEnabled = false
let parentDeathTimer: NodeJS.Timeout | null = null

const stopParentDeathMonitoring = () => {
  parentDeathDetectionEnabled = false
  if (parentDeathTimer) {
    clearTimeout(parentDeathTimer)
    parentDeathTimer = null
  }
}

const setupParentDeathMonitoring = (parentPid: number) => {
  if (parentDeathDetectionEnabled) return
  parentDeathDetectionEnabled = true

  let consecutiveFailures = 0
  const maxFailures = 3 // Require 3 consecutive failures before self-terminating

  // Check if parent is still alive every 2 seconds (more conservative)
  const checkParentAlive = () => {
    if (!parentDeathDetectionEnabled) return
    try {
      // Send signal 0 to check if process exists (doesn't actually send signal)
      process.kill(parentPid, 0)
      // If we reach here, parent is still alive, reset failure counter and check again later
      consecutiveFailures = 0
      parentDeathTimer = setTimeout(checkParentAlive, 2000)
    } catch {
      consecutiveFailures++
      console.warn(`[Worker ${process.pid}] Parent check failed (${consecutiveFailures}/${maxFailures})`)

      if (consecutiveFailures >= maxFailures) {
        // Parent process has been gone for multiple checks, self-terminate
        console.error(`[Worker ${process.pid}] Parent process ${parentPid} confirmed dead, self-terminating`)
        process.exit(0)
      } else {
        // Try again sooner on failure
        parentDeathTimer = setTimeout(checkParentAlive, 1000)
      }
    }
  }

  // Start monitoring after a longer initial delay to let things settle
  parentDeathTimer = setTimeout(checkParentAlive, 5000)
}

const platformRunnerImpl = Runner.PlatformRunner.of({
  [Runner.PlatformRunnerTypeId]: Runner.PlatformRunnerTypeId,
  start<I, O>(closeLatch: typeof CloseLatch.Service) {
    return Effect.gen(function* () {
      if (!process.send) {
        return yield* new WorkerError({ reason: 'spawn', cause: new Error('not in a child process') })
      }
      const port = {
        postMessage: (message: any) => process.send!(message),
        on: (event: string, handler: (message: any) => void) => process.on(event, handler),
        close: () => process.disconnect(),
      }
      const send = (_portId: number, message: O, _transfers?: ReadonlyArray<unknown>) =>
        Effect.sync(() => port.postMessage([1, message] /*, transfers as any*/))

      const run = Effect.fnUntraced(function* <A, E, R>(
        // biome-ignore lint/suspicious/noConfusingVoidType: need to support void
        handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void,
      ) {
        const runtime = (yield* Effect.interruptible(Effect.runtime<R | Scope.Scope>())).pipe(
          Runtime.updateContext(Context.omit(Scope.Scope)),
        ) as Runtime.Runtime<R>
        const fiberSet = yield* FiberSet.make<any, WorkerError | E>()
        const runFork = Runtime.runFork(runtime)
        const onExit = (exit: Exit.Exit<any, E>) => {
          if (exit._tag === 'Failure' && !Cause.isInterruptedOnly(exit.cause)) {
            // Deferred.unsafeDone(closeLatch, Exit.die(Cause.squash(exit.cause)))
            Deferred.unsafeDone(closeLatch, Exit.die(exit.cause))
          }
        }
        port.on('message', (message: Runner.BackingRunner.Message<I> | any) => {
          // console.log('message', message)

          // Handle parent death detection setup messages
          if (Array.isArray(message) && message[0] === 'setup-parent-death-detection' && message[1]?.parentPid) {
            const parentPid = message[1].parentPid
            // console.log(`[Worker ${process.pid}] Setting up parent death detection for parent ${parentPid}`)
            setupParentDeathMonitoring(parentPid)
            return
          }

          // Handle normal Effect worker messages
          if (Array.isArray(message) && typeof message[0] === 'number') {
            if (message[0] === 0) {
              const result = handler(0, message[1])
              if (Effect.isEffect(result)) {
                const fiber = runFork(result)
                fiber.addObserver(onExit)
                FiberSet.unsafeAdd(fiberSet, fiber)
              }
            } else {
              // Graceful shutdown requested by parent: stop monitoring and close port
              stopParentDeathMonitoring()
              Deferred.unsafeDone(closeLatch, Exit.void)
              port.close()
            }
          }
        })
        port.on('messageerror', (cause) => {
          Deferred.unsafeDone(closeLatch, new WorkerError({ reason: 'decode', cause }))
        })
        port.on('error', (cause) => {
          Deferred.unsafeDone(closeLatch, new WorkerError({ reason: 'unknown', cause }))
        })
        port.postMessage([0])
      })

      return { run, send }
    })
  },
})

export const layer = Layer.succeed(Runner.PlatformRunner, platformRunnerImpl)
