import * as Runner from '@effect/platform/WorkerRunner'
import { Context, Effect, Layer, Option, Stream } from 'effect'

// import { NodeRuntime, NodeWorkerRunner } from '@effect/platform-node'
import { PlatformNode } from '../../mod.ts'
import * as ChildProcessRunner from '../ChildProcessRunner.ts'
import { Person, User, WorkerMessage } from './schema.ts'

interface Name {
  readonly _: unique symbol
}
const Name = Context.GenericTag<Name, string>('Name')

const WorkerLive = Runner.layerSerialized(WorkerMessage, {
  GetPersonById: (req) => {
    return Stream.make(
      new Person({ id: req.id, name: 'test', data: new Uint8Array([1, 2, 3]) }),
      new Person({ id: req.id, name: 'ing', data: new Uint8Array([4, 5, 6]) }),
    )
  },
  GetUserById: (req) => Effect.map(Name, (name) => new User({ id: req.id, name })),
  // InitialMessage: (req) => Layer.succeed(Name, req.name),
  InitialMessage: (req) =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.log('closing worker scope'))
      return Layer.succeed(Name, req.name)
    }).pipe(Layer.unwrapScoped),
  // InitialMessage: (req) =>
  //   Layer.scoped(
  //     Name,
  //     Effect.gen(function* () {
  //       yield* Effect.addFinalizer(() => Effect.log('closing worker scope'))
  //       return req.name
  //     }),
  //   ),
  GetSpan: (_) =>
    Effect.gen(function* (_) {
      const span = yield* _(Effect.currentSpan, Effect.orDie)
      return {
        traceId: span.traceId,
        spanId: span.spanId,
        name: span.name,
        parent: Option.map(span.parent, (span) => ({
          traceId: span.traceId,
          spanId: span.spanId,
        })),
      }
    }).pipe(Effect.withSpan('GetSpan')),
  RunnerInterrupt: () => Effect.interrupt,
}).pipe(Layer.provide(ChildProcessRunner.layer))
// }).pipe(Layer.provide(PlatformNode.NodeWorkerRunner.layer))

PlatformNode.NodeRuntime.runMain(Runner.launch(WorkerLive))
