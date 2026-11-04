import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Deferred, Effect, Exit, Fiber, Schema, Scope, Stream, WebChannel } from '@livestore/utils/effect'

import * as WebmeshSchema from '../mesh-schema.ts'
import { makeMeshNode } from '../node.ts'
import { CacheService, CreateConnection } from './mod.ts'
import * as WorkerSchema from './schema.ts'

Vitest.live('CreateConnection keeps its edge alive until the caller scope closes', (test) =>
  Effect.gen(function* () {
    const node = yield* makeMeshNode('worker')
    const callerScope = yield* Scope.make()
    yield* Effect.addFinalizer((exit) => Scope.close(callerScope, exit))

    const mc = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => mc.port1.close()))
    const portClosed = yield* Deferred.make<void>()
    mc.port1.addEventListener('close', () => Deferred.doneUnsafe(portClosed, Exit.void), { once: true })
    const peer = yield* WebChannel.messagePortChannel({ port: mc.port2, schema: WebmeshSchema.Packet })
    const acknowledged = yield* Deferred.make<{}>()
    const ended = yield* Deferred.make<void>()

    const rpc = yield* CreateConnection(WorkerSchema.CreateConnection.make({ from: 'caller', port: mc.port1 })).pipe(
      Stream.tap((ack) => Deferred.succeed(acknowledged, ack)),
      Stream.runDrain,
      Effect.ensuring(Deferred.succeed(ended, undefined)),
      Effect.provideService(CacheService, CacheService.of({ node })),
      Effect.forkScoped,
      Scope.provide(callerScope),
    )

    expect(yield* Deferred.await(acknowledged)).toEqual({})
    // Let the callback finish after emitting the ack, without cancelling the RPC.
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(ended)).toBe(false)
    expect(yield* Deferred.isDone(portClosed)).toBe(false)

    const request = WebmeshSchema.NetworkTopologyRequest.make({ source: 'caller', target: '-', hops: ['caller'] })
    yield* peer.send(request)
    const responses = yield* peer.listen.pipe(
      Stream.mapEffect(Effect.fromResult),
      Stream.filter(Schema.is(WebmeshSchema.NetworkTopologyResponse)),
      Stream.take(1),
      Stream.runCollect,
    )
    expect(responses).toEqual([expect.objectContaining({ reqId: request.id, nodeName: 'worker', edges: ['caller'] })])
    expect(yield* Deferred.isDone(ended)).toBe(false)

    yield* Scope.close(callerScope, Exit.void)
    yield* Fiber.await(rpc)
    expect(yield* Deferred.isDone(ended)).toBe(true)
    yield* Deferred.await(portClosed)
  }).pipe(Vitest.withTestCtx(test)),
)
