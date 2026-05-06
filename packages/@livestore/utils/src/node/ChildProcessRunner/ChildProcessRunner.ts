import process from 'node:process'

import { WorkerError, WorkerReceiveError, WorkerSpawnError, WorkerUnknownError } from 'effect/unstable/workers/WorkerError'
import * as Runner from 'effect/unstable/workers/WorkerRunner'
import * as Cause from 'effect/Cause'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'

// Parent death monitoring setup
let parentDeathDetectionEnabled = false
let parentDeathTimer: NodeJS.Timeout | null = null

type SetupParentDeathDetectionMessage = ['setup-parent-death-detection', { parentPid: number }]
type RunnerMessage<I> = Runner.PlatformMessage<I> | SetupParentDeathDetectionMessage

const isSetupParentDeathDetectionMessage = (
  message: unknown,
): message is SetupParentDeathDetectionMessage =>
  Array.isArray(message) &&
  message[0] === 'setup-parent-death-detection' &&
  typeof message[1] === 'object' &&
  message[1] !== null &&
  'parentPid' in message[1] &&
  typeof (message[1] as { parentPid: unknown }).parentPid === 'number'

const stopParentDeathMonitoring = () => {
  parentDeathDetectionEnabled = false
  if (parentDeathTimer !== null) {
    clearTimeout(parentDeathTimer)
    parentDeathTimer = null
  }
}

const setupParentDeathMonitoring = (parentPid: number) => {
  if (parentDeathDetectionEnabled === true) return
  parentDeathDetectionEnabled = true

  let consecutiveFailures = 0
  const maxFailures = 3 // Require 3 consecutive failures before self-terminating

  // Check if parent is still alive every 2 seconds (more conservative)
  const checkParentAlive = () => {
    if (parentDeathDetectionEnabled === false) return
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

const platformRunnerImpl = Runner.WorkerRunnerPlatform.of({
  start<O = unknown, I = unknown>() {
    return Effect.gen(function* () {
      if (process.send == null) {
        return yield* new WorkerError({
          reason: new WorkerSpawnError({ message: 'not in a child process' }),
        })
      }
      const closeLatch = Deferred.makeUnsafe<void, WorkerError>()
      const port = {
        postMessage: (message: any) => process.send!(message),
        on: (event: string, handler: (message: any) => void) => process.on(event, handler),
        close: () => process.disconnect?.(),
      }
      const sendUnsafe = (_portId: number, message: O, _transfers?: ReadonlyArray<unknown>) =>
        port.postMessage(message)
      const send = (_portId: number, message: O, _transfers?: ReadonlyArray<unknown>) =>
        Effect.sync(() => sendUnsafe(_portId, [1, message] as any))

      const run = Effect.fnUntraced(function* <A, E, R>(
        // biome-ignore lint/suspicious/noConfusingVoidType: need to support void
        handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void,
      ) {
        const services = yield* Effect.context<R>()
        const runFork = Effect.runForkWith(services)
        const trackFiber = Fiber.runIn(yield* Effect.scope)
        const onExit = (exit: Exit.Exit<any, E>) => {
          if (exit._tag === 'Failure' && Cause.hasInterruptsOnly(exit.cause) === false) {
            Deferred.doneUnsafe(closeLatch, Exit.die(exit.cause))
          }
        }
        port.on('message', (message: RunnerMessage<I>) => {
          // console.log('message', message)

          // Handle parent death detection setup messages
          if (isSetupParentDeathDetectionMessage(message) === true) {
            const parentPid = message[1].parentPid
            // console.log(`[Worker ${process.pid}] Setting up parent death detection for parent ${parentPid}`)
            setupParentDeathMonitoring(parentPid)
            return
          }

          // Handle normal Effect worker messages
          if (Array.isArray(message) === true && typeof message[0] === 'number') {
            if (message[0] === 0) {
              const result = handler(0, message[1])
              if (Effect.isEffect(result) === true) {
                const fiber = runFork(result)
                fiber.addObserver(onExit)
                trackFiber(fiber)
              }
            } else {
              // Graceful shutdown requested by parent: stop monitoring and close port
              stopParentDeathMonitoring()
              Deferred.doneUnsafe(closeLatch, Exit.void)
              port.close()
            }
          }
        })
        port.on('messageerror', (cause) => {
          Deferred.doneUnsafe(
            closeLatch,
            new WorkerError({
              reason: new WorkerReceiveError({ message: 'received messageerror event', cause }),
            }).asEffect(),
          )
        })
        port.on('error', (cause) => {
          Deferred.doneUnsafe(
            closeLatch,
            new WorkerError({
              reason: new WorkerUnknownError({ message: 'received error event', cause }),
            }).asEffect(),
          )
        })
        port.postMessage([0])
        return yield* Deferred.await(closeLatch)
      })

      return { run, send, sendUnsafe } as any
    })
  },
})

export const layer = Layer.succeed(Runner.WorkerRunnerPlatform, platformRunnerImpl)
