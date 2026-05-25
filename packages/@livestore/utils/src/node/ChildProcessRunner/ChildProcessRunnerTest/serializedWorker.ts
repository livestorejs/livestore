import { Effect, Layer, Option, Schema, Stream } from 'effect'
import { RpcServer } from 'effect/unstable/rpc'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as ChildProcessRunner from '../ChildProcessRunner.ts'
import { InitialMessage, Person, User, WorkerRpcs } from './schema.ts'

const WorkerHandlers = WorkerRpcs.toLayer({
  GetPersonById: ({ id }) =>
    Stream.make(
      new Person({ id, name: 'test', data: new Uint8Array([1, 2, 3]) }),
      new Person({ id, name: 'ing', data: new Uint8Array([4, 5, 6]) }),
    ),
  GetUserById: ({ id }) =>
    Effect.gen(function* () {
      const protocol = yield* RpcServer.Protocol
      const initialMessage = yield* protocol.initialMessage.pipe(
        Effect.flatMap((option) => Effect.fromOption(option)),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.toCodecJson(InitialMessage))),
        Effect.orDie,
      )
      return new User({ id, name: initialMessage.name })
    }),
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
})

const WorkerLive = WorkerHandlers.pipe(
  Layer.provideMerge(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(ChildProcessRunner.layer),
)

NodeRuntime.runMain(
  RpcServer.make(WorkerRpcs).pipe(Effect.provide(WorkerLive)) as Effect.Effect<never, never, never>,
)
