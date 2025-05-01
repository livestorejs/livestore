import { LS_DEV } from '@livestore/utils'
import { Context, Effect, Layer, Stream, WebChannel } from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'
import { makeMeshNode, WebmeshSchema } from '@livestore/webmesh'

import type * as SharedWorkerSchema from './schema.js'

export * as Schema from './schema.js'

export class CacheService extends Context.Tag('@livestore/devtools-web-common:CacheService')<
  CacheService,
  { node: MeshNode }
>() {
  static layer = ({ nodeName }: { nodeName: string }) =>
    Effect.gen(function* () {
      const node = yield* makeMeshNode(nodeName)

      globalThis.__debugWebmeshNode = node

      return { node }
    }).pipe(Layer.scoped(CacheService))
}

export const CreateConnection = ({ from, port }: typeof SharedWorkerSchema.CreateConnection.Type) =>
  Stream.asyncScoped<{}, never, CacheService>((emit) =>
    Effect.gen(function* () {
      const { node } = yield* CacheService

      const messagePortChannel = yield* WebChannel.messagePortChannel({ port, schema: WebmeshSchema.Packet })

      yield* node.addEdge({ target: from, edgeChannel: messagePortChannel, replaceIfExists: true })

      if (LS_DEV) {
        yield* Effect.logDebug(`@livestore/devtools-web-common: accepted edge: ${node.nodeName} ← ${from}`)
      }

      emit.single({})

      yield* Effect.spanEvent({ connectedTo: [...node.edgeKeys] })

      // Keep connection alive
      // yield* Effect.never

      // return {}
    }).pipe(Effect.orDie),
  ).pipe(Stream.withSpan(`@livestore/devtools-web-common:worker:create-connection:${from}`))
