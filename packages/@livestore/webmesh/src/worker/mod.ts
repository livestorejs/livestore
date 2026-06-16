import { LS_DEV } from '@livestore/utils'
import { Context, Deferred, Effect, Layer, Stream, WebChannel, type Worker } from '@livestore/utils/effect'

import * as WebmeshSchema from '../mesh-schema.ts'
import type { MeshNode } from '../node.ts'
import { makeMeshNode } from '../node.ts'
import * as WorkerSchema from './schema.ts'

export * as Schema from './schema.ts'

declare global {
  var __debugWebmeshNode: any
}

export class CacheService extends Context.Tag('@livestore/webmesh:worker:CacheService')<
  CacheService,
  { node: MeshNode }
>() {
  static layer = ({ nodeName }: { nodeName: string }) =>
    Effect.gen(function* () {
      const node = yield* makeMeshNode(nodeName)

      globalThis.__debugWebmeshNode = node

      return { node }
    }).pipe(Layer.effect(CacheService))
}

export const CreateConnection = ({ from, port }: typeof WorkerSchema.CreateConnection.Type) =>
  Stream.callback<{}, never, CacheService>((emit) =>
    Effect.gen(function* () {
      const { node } = yield* CacheService

      const messagePortChannel = yield* WebChannel.messagePortChannel({ port, schema: WebmeshSchema.Packet })

      yield* node.addEdge({ target: from, edgeChannel: messagePortChannel, replaceIfExists: true })

      if (LS_DEV === true) {
        yield* Effect.logDebug(`@livestore/webmesh:worker: accepted edge: ${node.nodeName} <- ${from}`)
      }

      emit.single({})

      yield* Effect.spanEvent({ connectedTo: [...node.edgeKeys] })
    }).pipe(Effect.orDie),
  ).pipe(Stream.withSpan(`@livestore/webmesh:worker:create-connection:${from}`))

export const connectViaWorker = ({
  node,
  target,
  worker,
}: {
  node: MeshNode
  target: string
  worker: Worker.SerializedWorkerPool<typeof WorkerSchema.Request.Type>
}) =>
  Effect.gen(function* () {
    const mc = new MessageChannel()

    const isConnected = yield* Deferred.make<boolean>()

    if (LS_DEV === true) {
      yield* Effect.addFinalizerLog(`@livestore/webmesh:worker: closing message channel ${node.nodeName} -> ${target}`)
    }

    yield* worker.execute(WorkerSchema.CreateConnection.make({ from: node.nodeName, port: mc.port1 })).pipe(
      Stream.tap(() => Deferred.succeed(isConnected, true)),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
      Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
    )

    yield* Deferred.await(isConnected)

    const workerConnection = yield* WebChannel.messagePortChannel({
      port: mc.port2,
      schema: WebmeshSchema.Packet,
    })

    yield* node.addEdge({ target, edgeChannel: workerConnection, replaceIfExists: true })

    if (LS_DEV === true) {
      yield* Effect.logDebug(`@livestore/webmesh:worker: initiated connection: ${node.nodeName} -> ${target}`)
    }
  })
