/* eslint-disable prefer-arrow/prefer-arrow-functions */

import type * as ChildProcess from 'node:child_process'

import * as Worker from '@effect/platform/Worker'
import { WorkerError } from '@effect/platform/WorkerError'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Scope from 'effect/Scope'

const platformWorkerImpl = Worker.makePlatform<ChildProcess.ChildProcess>()({
  setup({ scope, worker: childProcess }) {
    return Effect.flatMap(Deferred.make<void, WorkerError>(), (exitDeferred) => {
      childProcess.on('exit', () => {
        console.log('child-process-exited')
        Deferred.unsafeDone(exitDeferred, Exit.void)
      })
      return Effect.as(
        Scope.addFinalizer(
          scope,
          Effect.suspend(() => {
            return Effect.sync(() => childProcess.send([1])).pipe(
              Effect.withSpan('send-graceful-shutdown'),
              Effect.zipRight(Deferred.await(exitDeferred)),
              Effect.withSpan('send-graceful-shutdown-wait-completed'),
            )
          }).pipe(
            Effect.interruptible,
            Effect.timeout(50_000_000),
            Effect.catchAllCause(() => Effect.sync(() => childProcess.kill())),
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

/** @internal */
export const layerWorker = Layer.succeed(Worker.PlatformWorker, platformWorkerImpl)

/** @internal */
export const layerManager = Layer.provide(Worker.layerManager, layerWorker)

/** @internal */
export const layer = (spawn: (id: number) => ChildProcess.ChildProcess) =>
  Layer.merge(layerManager, Worker.layerSpawner(spawn))
