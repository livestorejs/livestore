/* eslint-disable prefer-arrow/prefer-arrow-functions */

import * as Worker from '@effect/platform/Worker'
import { WorkerError } from '@effect/platform/WorkerError'
// eslint-disable-next-line unicorn/prefer-node-protocol
import type * as ChildProcess from 'child_process'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Scope from 'effect/Scope'

const platformWorkerImpl = Worker.makePlatform<ChildProcess.ChildProcess>()({
  setup({ scope, worker: childProcess }) {
    return Effect.flatMap(Deferred.make<void, WorkerError>(), (exitDeferred) => {
      childProcess.on('exit', () => {
        Deferred.unsafeDone(exitDeferred, Exit.void)
      })
      return Effect.as(
        Scope.addFinalizer(
          scope,
          Effect.suspend(() => {
            childProcess.send([1])
            return Deferred.await(exitDeferred)
          }).pipe(
            Effect.interruptible,
            Effect.timeout(5000),
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

export const layerWorker = Layer.succeed(Worker.PlatformWorker, platformWorkerImpl)

export const layerManager = Layer.provide(Worker.layerManager, layerWorker)

export const layer = (spawn: (id: number) => ChildProcess.ChildProcess) =>
  Layer.merge(layerManager, Worker.layerSpawner(spawn))
