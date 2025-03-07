import { Devtools } from '@livestore/common'
import type { Scope, Worker } from '@livestore/utils/effect'
import { Effect } from '@livestore/utils/effect'

import { makeChannelForConnectedMeshNode, makeWebDevtoolsConnectedMeshNode } from '../web-channel/index.js'
import type * as WorkerSchema from '../worker/schema.js'

// TODO use a unique bridgeId for each connection (similar to web bridge)
// TODO refactor the bridge creation code to be re-used for both web and node and possibly expo
export const prepareWebDevtoolsBridge = ({
  worker,
  workerTargetName,
  storeId,
  clientId,
  sessionId,
}: {
  worker: Worker.SerializedWorkerPool<typeof WorkerSchema.Request.Type>
  /** Usually `shared-worker` */
  workerTargetName: string
  storeId: string
  clientId: string
  sessionId: string
}): Effect.Effect<Devtools.PrepareDevtoolsBridge, never, Scope.Scope> =>
  Effect.gen(function* () {
    const meshNode = yield* makeWebDevtoolsConnectedMeshNode({
      nodeName: `devtools`,
      target: workerTargetName,
      worker,
    })

    // @ts-expect-error typing
    globalThis.__debugWebMeshNode = meshNode

    const isLeader = true // TODO properly implement this

    // TODO maybe we need a temporary channel to create a unique bridge channel e..g see appHostInfoDeferred below
    const webDevtoolsChannelStore = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target: `client-session-${storeId}-${clientId}-${sessionId}`,
      schema: {
        listen: Devtools.ClientSession.MessageFromApp,
        send: Devtools.ClientSession.MessageToApp,
      },
    })

    const webDevtoolsChannelCoordinator = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target: `leader-${storeId}-${clientId}`,
      schema: { listen: Devtools.Leader.MessageFromApp, send: Devtools.Leader.MessageToApp },
    })

    // const responsePubSub = yield* PubSub.unbounded<
    //   Devtools.MessageFromApp | Devtools.MessageFromApp
    // >().pipe(Effect.acquireRelease(PubSub.shutdown))

    // // const appHostInfoDeferred = yield* Deferred.make<{ appHostId: string; isLeader: boolean }>()

    // yield* webDevtoolsChannelCoordinator.listen.pipe(
    //   Stream.flatten(),
    //   // Stream.tapLogWithLabel('fromCoordinator.listen'),
    //   Stream.tap((msg) =>
    //     Effect.gen(function* () {
    //       yield* PubSub.publish(responsePubSub, msg)
    //     }),
    //   ),
    //   Stream.runDrain,
    //   Effect.withSpan('portForDevtoolsChannelCoordinator.listen'),
    //   Effect.tapCauseLogPretty,
    //   Effect.forkScoped,
    // )

    // yield* webDevtoolsChannelStore.listen.pipe(
    //   Stream.flatten(),
    //   // Stream.tapLogWithLabel('fromStore.listen'),
    //   Stream.tap((msg) =>
    //     Effect.gen(function* () {
    //       yield* PubSub.publish(responsePubSub, msg)
    //     }),
    //   ),
    //   Stream.runDrain,
    //   Effect.withSpan('portForDevtoolsChannelStore.listen'),
    //   Effect.tapCauseLogPretty,
    //   Effect.forkScoped,
    // )

    // // yield* webDevtoolsChannelCoordinator.send(Devtools.DevtoolsReady.make({ liveStoreVersion }))

    // // const { appHostId, isLeader } = yield* Deferred.await(appHostInfoDeferred)

    // // TODO improve disconnect handling
    // yield* Deferred.await(webDevtoolsChannelCoordinator.closedDeferred).pipe(
    //   Effect.tap(() =>
    //     PubSub.publish(responsePubSub, Devtools.Disconnect.make({ liveStoreVersion, clientId, sessionId })),
    //   ),
    //   Effect.tapCauseLogPretty,
    //   Effect.forkScoped,
    // )

    // // TODO improve disconnect handling
    // yield* Deferred.await(webDevtoolsChannelStore.closedDeferred).pipe(
    //   Effect.tap(() =>
    //     PubSub.publish(responsePubSub, Devtools.Disconnect.make({ liveStoreVersion, clientId, sessionId })),
    //   ),
    //   Effect.tapCauseLogPretty,
    //   Effect.forkScoped,
    // )

    // const sendToAppHost: Devtools.PrepareDevtoolsBridge['sendToAppHost'] = (msg) =>
    //   Effect.gen(function* () {
    //     // NOTE it's possible that a message is for both the coordinator and the store (e.g. Disconnect)
    //     if (Schema.is(Devtools.MessageToApp)(msg)) {
    //       yield* webDevtoolsChannelCoordinator.send(msg)
    //     }

    //     if (Schema.is(Devtools.MessageToApp)(msg)) {
    //       yield* webDevtoolsChannelStore.send(msg)
    //     }
    //   }).pipe(Effect.withSpan('sendToAppHost'), Effect.orDie)

    const copyToClipboard = (text: string) =>
      Effect.sync(() => {
        navigator.clipboard.writeText(text)
      })

    return {
      webchannels: {
        leader: webDevtoolsChannelCoordinator,
        clientSession: webDevtoolsChannelStore,
      },
      clientInfo: { clientId, sessionId, isLeader },
      copyToClipboard,
    } satisfies Devtools.PrepareDevtoolsBridge
  }).pipe(Effect.orDie)
