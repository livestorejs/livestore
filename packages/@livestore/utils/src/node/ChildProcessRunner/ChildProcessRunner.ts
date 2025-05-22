/* eslint-disable prefer-arrow/prefer-arrow-functions */
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
        port.on('message', (message: Runner.BackingRunner.Message<I>) => {
          // console.log('message', message)
          if (message[0] === 0) {
            const result = handler(0, message[1])
            if (Effect.isEffect(result)) {
              const fiber = runFork(result)
              fiber.addObserver(onExit)
              FiberSet.unsafeAdd(fiberSet, fiber)
            }
          } else {
            Deferred.unsafeDone(closeLatch, Exit.void)
            port.close()
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
