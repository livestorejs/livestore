import { Effect, Layer, Option, Stream } from 'effect'
import { RpcServer, RpcWorker } from 'effect/unstable/rpc'

import { PlatformNode } from '../../mod.ts'
import * as ChildProcessRunner from '../ChildProcessRunner.ts'
import { InitialMessage, Person, User, WorkerRpcs } from './schema.ts'

const handlersLayer = WorkerRpcs.toLayer(
  Effect.gen(function* () {
    const initialMessage = yield* RpcWorker.initialMessage(InitialMessage)

    return {
      GetPersonById: ({ id }) =>
        Stream.make(
          new Person({ id, name: 'test', data: new Uint8Array([1, 2, 3]) }),
          new Person({ id, name: 'ing', data: new Uint8Array([4, 5, 6]) }),
        ),
      GetUserById: ({ id }) => Effect.succeed(new User({ id, name: initialMessage.name })),
      GetSpan: Effect.fn('GetSpan')(function* () {
        const span = yield* Effect.currentSpan.pipe(Effect.orDie)
        return {
          traceId: span.traceId,
          spanId: span.spanId,
          name: span.name,
          parent: Option.map(span.parent, (span) => ({
            traceId: span.traceId,
            spanId: span.spanId,
          })),
        }
      }),
      RunnerInterrupt: () => Effect.interrupt,
      StartStubbornWorker: ({ blockDuration }) =>
        Effect.gen(function* () {
          const pid = process.pid
          yield* Effect.forkChild(
            Effect.gen(function* () {
              yield* Effect.sleep(`${blockDuration} millis`)
              yield* Effect.log('Stubborn worker finished blocking')
            }).pipe(Effect.uninterruptible),
          )
          return { pid }
        }),
    }
  }),
)

const WorkerLive = RpcServer.layer(WorkerRpcs).pipe(
  Layer.provide(handlersLayer),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(ChildProcessRunner.layer),
)

PlatformNode.NodeRuntime.runMain(Layer.launch(WorkerLive))
