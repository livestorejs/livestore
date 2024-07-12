import { WorkerError } from '@effect/platform/WorkerError'
import * as Runner from '@effect/platform/WorkerRunner'
import { Deferred } from 'effect'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Schedule from 'effect/Schedule'

const platformRunnerImpl = (port: MessagePort) =>
  Runner.PlatformRunner.of({
    [Runner.PlatformRunnerTypeId]: Runner.PlatformRunnerTypeId,
    start: <I, O>(shutdown: Effect.Effect<void>) => {
      return Effect.gen(function* () {
        const queue = yield* Queue.unbounded<readonly [portId: number, message: I]>()

        const latch = yield* Deferred.make<void>()

        yield* Effect.async<never, WorkerError>((resume) => {
          const onMessage = (msg: MessageEvent<Runner.BackingRunner.Message<I>>) => {
            const message = msg.data
            if (message[0] === 0) {
              queue.unsafeOffer([0, message[1]])
            } else {
              Effect.runFork(shutdown)
            }
          }

          const onError = (error: any) => {
            resume(new WorkerError({ reason: 'decode', error }))
          }

          port.addEventListener('message', onMessage)
          port.addEventListener('messageerror', onError)
          port.addEventListener('error', onError)

          Deferred.unsafeDone(latch, Effect.void)

          return Effect.sync(() => {
            port.removeEventListener('message', onMessage as any)
            port.removeEventListener('error', onError as any)
          })
        }).pipe(
          Effect.tapErrorCause((cause) => (Cause.isInterruptedOnly(cause) ? Effect.void : Effect.logDebug(cause))),
          Effect.retry(Schedule.forever),
          Effect.annotateLogs({
            package: '@livestore/utils/effect',
            module: 'PortPlatformRunner',
          }),
          Effect.interruptible,
          Effect.forkScoped,
        )

        yield* Deferred.await(latch)

        port.start()

        const send = (_portId: number, message: O, transfers?: ReadonlyArray<unknown>) =>
          Effect.try({
            try: () => port.postMessage([1, message], transfers as any),
            catch: (error) => new WorkerError({ reason: 'send', error }),
          }).pipe(Effect.catchTag('WorkerError', Effect.orDie))

        // ready
        port.postMessage([0])

        return { queue, send }
      })
    },
  })

/** @internal */
export const layer = (port: MessagePort) => Layer.succeed(Runner.PlatformRunner, platformRunnerImpl(port))
