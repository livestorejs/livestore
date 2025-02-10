import { Devtools, liveStoreVersion } from '@livestore/common'
import type { Scope } from '@livestore/utils/effect'
import { Deferred, Effect, PubSub, Schema, Stream } from '@livestore/utils/effect'

import { makeChannelForConnectedMeshNode, makeNodeDevtoolsConnectedMeshNode } from '../web-channel/index.js'

export const prepareNodeDevtoolsBridge = ({
  url,
  storeId,
  clientId,
  sessionId,
}: {
  url: string
  storeId: string
  clientId: string
  sessionId: string
}): Effect.Effect<Devtools.PrepareDevtoolsBridge, never, Scope.Scope> =>
  Effect.gen(function* () {
    const meshNode = yield* makeNodeDevtoolsConnectedMeshNode({ nodeName: `devtools`, url })

    const isLeader = true // For now we only support a single node instance, which always is the leader

    // TODO maybe we need a temporary channel to create a unique bridge channel e..g see appHostInfoDeferred below
    const nodeDevtoolsChannelStore = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target: `client-session-${storeId}-${clientId}-${sessionId}`,
      schema: {
        listen: Devtools.ClientSession.MessageFromApp,
        send: Devtools.ClientSession.MessageToApp,
      },
    })

    const nodeDevtoolsChannelCoordinator = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target: `leader-${storeId}-${clientId}`,
      schema: {
        listen: Devtools.Leader.MessageFromApp,
        send: Devtools.Leader.MessageToApp,
      },
    })

    // const responsePubSub = yield* PubSub.unbounded<
    //   Devtools.MessageFromApp | Devtools.MessageFromApp
    // >().pipe(Effect.acquireRelease(PubSub.shutdown))

    // // const appHostInfoDeferred = yield* Deferred.make<{ appHostId: string; isLeader: boolean }>()

    // yield* nodeDevtoolsChannelCoordinator.listen.pipe(
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

    // yield* nodeDevtoolsChannelStore.listen.pipe(
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

    // // yield* nodeDevtoolsChannelCoordinator.send(Devtools.DevtoolsReady.make({ liveStoreVersion }))

    // // const { appHostId, isLeader } = yield* Deferred.await(appHostInfoDeferred)

    // // TODO improve disconnect handling
    // yield* Deferred.await(nodeDevtoolsChannelCoordinator.closedDeferred).pipe(
    //   Effect.tap(() =>
    //     PubSub.publish(responsePubSub, Devtools.Disconnect.make({ liveStoreVersion, clientId, sessionId })),
    //   ),
    //   Effect.tapCauseLogPretty,
    //   Effect.forkScoped,
    // )

    // // TODO improve disconnect handling
    // yield* Deferred.await(nodeDevtoolsChannelStore.closedDeferred).pipe(
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
    //       yield* nodeDevtoolsChannelCoordinator.send(msg)
    //     }

    //     if (Schema.is(Devtools.MessageToApp)(msg)) {
    //       yield* nodeDevtoolsChannelStore.send(msg)
    //     }
    //   }).pipe(Effect.withSpan('sendToAppHost'), Effect.orDie)

    const copyToClipboard = (text: string) =>
      Effect.sync(() => {
        navigator.clipboard.writeText(text)
      })

    return {
      webchannels: {
        leader: nodeDevtoolsChannelCoordinator,
        clientSession: nodeDevtoolsChannelStore,
      },
      clientInfo: { clientId, sessionId, isLeader },
      copyToClipboard,
    } satisfies Devtools.PrepareDevtoolsBridge
  }).pipe(Effect.orDie)
