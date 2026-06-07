import { LS_DEV } from '@livestore/utils'
import {
  Context,
  Deferred,
  Effect,
  EffectRpcClient,
  Layer,
  RpcClientError,
  Stream,
  WebChannel,
} from '@livestore/utils/effect'

import * as WebmeshSchema from '../mesh-schema.ts'
import type { MeshNode } from '../node.ts'
import { makeMeshNode } from '../node.ts'
import * as WorkerSchema from './schema.ts'

export * as Schema from './schema.ts'

declare global {
  var __debugWebmeshNode: any
}

export class CacheService extends Context.Service<CacheService, { node: MeshNode }>()(
  '@livestore/webmesh:worker:CacheService',
) {
  static layer = ({ nodeName }: { nodeName: string }) =>
    Effect.gen(function* () {
      const node = yield* makeMeshNode(nodeName)

      globalThis.__debugWebmeshNode = node

      return { node }
    }).pipe(Layer.effect(CacheService))
}

export type WorkerClient = EffectRpcClient.FromGroup<typeof WorkerSchema.Rpcs, RpcClientError.RpcClientError>

type CreateConnectionPayload = {
  from: string
  port: MessagePort
}

export const CreateConnection = ({ from, port }: CreateConnectionPayload) =>
  Stream.fromEffect(
    Effect.gen(function* () {
      const { node } = yield* CacheService

      const messagePortChannel = yield* WebChannel.messagePortChannel({ port, schema: WebmeshSchema.Packet })

      yield* node.addEdge({ target: from, edgeChannel: messagePortChannel, replaceIfExists: true })

      if (LS_DEV === true) {
        yield* Effect.logDebug(`@livestore/webmesh:worker: accepted edge: ${node.nodeName} <- ${from}`)
      }

      yield* Effect.spanEvent({ connectedTo: [...node.edgeKeys] })
      return {}
    }).pipe(Effect.orDie),
  ).pipe(Stream.withSpan(`@livestore/webmesh:worker:create-connection:${from}`))

export const connectViaWorker = ({
  node,
  target,
  worker,
}: {
  node: MeshNode
  target: string
  worker: WorkerClient
}) =>
  Effect.gen(function* () {
    const mc = new MessageChannel()

    const isConnected = yield* Deferred.make<boolean>()

    if (LS_DEV === true) {
      yield* Effect.addFinalizerLog(
        `@livestore/webmesh:worker: closing message channel ${node.nodeName} -> ${target}`,
      )
    }

    yield* worker.CreateConnection({ from: node.nodeName, port: mc.port1 }).pipe(
      Stream.tap(() => Deferred.succeed(isConnected, true)),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
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
