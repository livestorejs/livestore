import { UnexpectedError } from '@livestore/common'
import { LS_DEV } from '@livestore/utils'
import type { Scope, Worker } from '@livestore/utils/effect'
import { Deferred, Effect, Stream, WebChannel } from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'
import { makeMeshNode, WebmeshSchema } from '@livestore/webmesh'

import * as WorkerSchema from '../worker/schema.js'

export const makeWebDevtoolsConnectedMeshNode = ({
  nodeName,
  target,
  worker,
}: {
  nodeName: string
  target: string
  worker: Worker.SerializedWorkerPool<typeof WorkerSchema.Request.Type>
}) =>
  Effect.gen(function* () {
    const node = yield* makeMeshNode(nodeName)

    yield* connectViaWorker({ node, target, worker })

    return node
  })

export const makeChannelForConnectedMeshNode = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  target,
  node,
  schema,
}: {
  node: MeshNode
  target: string
  schema: WebChannel.InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
}) =>
  node.makeChannel({
    target,
    channelName: 'devtools:' + [node.nodeName, target].sort().join('_'),
    schema,
    mode: 'messagechannel',
  })

export const makeWebDevtoolsChannel = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  nodeName,
  target,
  schema,
  worker,
  workerTargetName,
}: {
  nodeName: string
  target: string
  schema: WebChannel.InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
  worker: Worker.SerializedWorkerPool<typeof WorkerSchema.Request.Type>
  workerTargetName: string
}): Effect.Effect<WebChannel.WebChannel<MsgListen, MsgSend>, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const node = yield* makeWebDevtoolsConnectedMeshNode({ nodeName, target: workerTargetName, worker })

    const channel = yield* makeChannelForConnectedMeshNode({ node, target, schema })

    return channel
  }).pipe(Effect.withSpan(`devtools-web-common:makeWebDevtoolsChannel`))

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

    yield* Effect.addFinalizerLog(
      `@livestore/devtools-web-common: closing message channel ${node.nodeName} → ${target}`,
    )

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

    yield* node.addConnection({ target, connectionChannel: sharedWorkerConnection, replaceIfExists: true })

    if (LS_DEV) {
      yield* Effect.logDebug(`@livestore/devtools-web-common: initiated connection: ${node.nodeName} → ${target}`)
    }
  }).pipe(UnexpectedError.mapToUnexpectedError)
