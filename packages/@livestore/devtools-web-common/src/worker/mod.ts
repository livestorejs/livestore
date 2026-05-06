import { LS_DEV } from '@livestore/utils'
import { Context, Effect, Layer, Stream, WebChannel } from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'
import { makeMeshNode, WebmeshSchema } from '@livestore/webmesh'

import type * as SharedWorkerSchema from './schema.ts'

export * as Schema from './schema.ts'

export class CacheService extends Context.Service<
  CacheService,
  { node: MeshNode }
>()('@livestore/devtools-web-common:CacheService') {
  static layer = ({ nodeName }: { nodeName: string }) =>
    Effect.gen(function* () {
      const node = yield* makeMeshNode(nodeName)

      globalThis.__debugWebmeshNode = node

      return { node }
    }).pipe(Layer.effect(CacheService))
}

export const CreateConnection = ({ from, port }: typeof SharedWorkerSchema.CreateConnection.Type) =>
  Effect.gen(function* () {
      const { node } = yield* CacheService

      const messagePortChannel = yield* WebChannel.messagePortChannel({ port, schema: WebmeshSchema.Packet })

      yield* node.addEdge({ target: from, edgeChannel: messagePortChannel, replaceIfExists: true })

      if (LS_DEV === true) {
        yield* Effect.logDebug(`@livestore/devtools-web-common: accepted edge: ${node.nodeName} ← ${from}`)
      }

      yield* Effect.spanEvent({ connectedTo: [...node.edgeKeys] })

      return {}
    }).pipe(
      Effect.orDie,
      Stream.fromEffect,
      Stream.withSpan(`@livestore/devtools-web-common:worker:create-connection:${from}`),
    )
