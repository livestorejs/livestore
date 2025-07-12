import { Devtools, UnexpectedError } from '@livestore/common'
import { LS_DEV } from '@livestore/utils'
import type { Scope, Worker } from '@livestore/utils/effect'
import { Deferred, Effect, Schema, Stream, WebChannel } from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'
import { WebmeshSchema } from '@livestore/webmesh'

import * as WorkerSchema from '../worker/schema.ts'

export * as WorkerSchema from '../worker/schema.ts'

declare global {
  var __debugWebmeshNode: any
}

export const makeSessionInfoBroadcastChannel: Effect.Effect<
  WebChannel.WebChannel<Devtools.SessionInfo.Message, Devtools.SessionInfo.Message>,
  UnexpectedError,
  Scope.Scope
> = WebChannel.broadcastChannel({
  channelName: 'session-info',
  schema: Devtools.SessionInfo.Message,
})

export const makeNodeName = {
  sharedWorker: ({ storeId }: { storeId: string }) => `shared-worker-${storeId}`,
  // TODO refactor shared-worker setup so there's only a single shared-worker per origin
  // sharedWorker: () => `shared-worker`,
  browserExtension: {
    contentscriptMain: (tabId: number) => `contentscript-main-${tabId}`,
    contentscriptIframe: (tabId: number) => `contentscript-iframe-${tabId}`,
  },
}

export const ClientSessionContentscriptMainReq = Schema.TaggedStruct('ClientSessionContentscriptMainReq', {
  storeId: Schema.String,
  clientId: Schema.String,
  sessionId: Schema.String,
})

export const ClientSessionContentscriptMainRes = Schema.TaggedStruct('ClientSessionContentscriptMainRes', {
  tabId: Schema.Number,
})

// Effect.suspend is needed since `window` is not available in the shared worker
export const makeStaticClientSessionChannel = {
  contentscriptMain: Effect.suspend(() =>
    WebChannel.windowChannel({
      listenWindow: window,

      sendWindow: window,
      schema: { listen: ClientSessionContentscriptMainReq, send: ClientSessionContentscriptMainRes },
      ids: { own: 'contentscript-main-static', other: 'client-session-static' },
    }),
  ),
  clientSession: Effect.suspend(() =>
    WebChannel.windowChannel({
      listenWindow: window,

      sendWindow: window,
      schema: { listen: ClientSessionContentscriptMainRes, send: ClientSessionContentscriptMainReq },
      ids: { own: 'client-session-static', other: 'contentscript-main-static' },
    }),
  ),
}

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

    const isConnected = yield* Deferred.make<boolean, never>()

    if (LS_DEV) {
      yield* Effect.addFinalizerLog(
        `@livestore/devtools-web-common: closing message channel ${node.nodeName} → ${target}`,
      )
    }

    yield* worker.execute(WorkerSchema.CreateConnection.make({ from: node.nodeName, port: mc.port1 })).pipe(
      Stream.tap(() => Deferred.succeed(isConnected, true)),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* isConnected

    const sharedWorkerConnection = yield* WebChannel.messagePortChannel({
      port: mc.port2,
      schema: WebmeshSchema.Packet,
    })

    yield* node.addEdge({ target, edgeChannel: sharedWorkerConnection, replaceIfExists: true })

    if (LS_DEV) {
      yield* Effect.logDebug(`@livestore/devtools-web-common: initiated connection: ${node.nodeName} → ${target}`)
    }
  }).pipe(UnexpectedError.mapToUnexpectedError)
