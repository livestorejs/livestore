import { Devtools, liveStoreVersion } from '@livestore/common'
import type { Scope } from '@livestore/utils/effect'
import { Deferred, Effect, PubSub, Schema, Stream } from '@livestore/utils/effect'

import { makeChannelForConnectedMeshNode, makeNodeDevtoolsConnectedMeshNode } from '../web-channel/index.js'

// TODO use a unique bridgeId for each connection (similar to web bridge)
export const prepareNodeDevtoolsBridge = ({
  url,
  storeId,
}: {
  url: string
  storeId: string
}): Effect.Effect<Devtools.PrepareDevtoolsBridge, never, Scope.Scope> =>
  Effect.gen(function* () {
    const meshNode = yield* makeNodeDevtoolsConnectedMeshNode({ nodeName: `devtools`, url })

    const sessionId = 'static'
    const appHostId = `${storeId}-${sessionId}`
    const isLeader = true // For now we only support a single node instance, which always is the leader

    // TODO maybe we need a temporary channel to create a unique bridge channel e..g see appHostInfoDeferred below
    const nodeDevtoolsChannelStore = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target: `app-store-${appHostId}`,
      schema: { listen: Devtools.MessageFromAppClientSession, send: Devtools.MessageToAppClientSession },
    })

    const nodeDevtoolsChannelCoordinator = yield* makeChannelForConnectedMeshNode({
      node: meshNode,
      target: `app-coordinator-${appHostId}`,
      schema: { listen: Devtools.MessageFromAppLeader, send: Devtools.MessageToAppLeader },
    })

    const responsePubSub = yield* PubSub.unbounded<
      Devtools.MessageFromAppLeader | Devtools.MessageFromAppClientSession
    >().pipe(Effect.acquireRelease(PubSub.shutdown))

    // const appHostInfoDeferred = yield* Deferred.make<{ appHostId: string; isLeader: boolean }>()

    yield* nodeDevtoolsChannelCoordinator.listen.pipe(
      Stream.flatten(),
      // Stream.tapLogWithLabel('fromCoordinator.listen'),
      Stream.tap((msg) =>
        Effect.gen(function* () {
          yield* PubSub.publish(responsePubSub, msg)
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('portForDevtoolsChannelCoordinator.listen'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* nodeDevtoolsChannelStore.listen.pipe(
      Stream.flatten(),
      // Stream.tapLogWithLabel('fromStore.listen'),
      Stream.tap((msg) =>
        Effect.gen(function* () {
          yield* PubSub.publish(responsePubSub, msg)
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('portForDevtoolsChannelStore.listen'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    // yield* nodeDevtoolsChannelCoordinator.send(Devtools.DevtoolsReady.make({ liveStoreVersion }))

    // const { appHostId, isLeader } = yield* Deferred.await(appHostInfoDeferred)

    // TODO improve disconnect handling
    yield* Deferred.await(nodeDevtoolsChannelCoordinator.closedDeferred).pipe(
      Effect.tap(() => PubSub.publish(responsePubSub, Devtools.Disconnect.make({ liveStoreVersion, appHostId }))),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    // TODO improve disconnect handling
    yield* Deferred.await(nodeDevtoolsChannelStore.closedDeferred).pipe(
      Effect.tap(() => PubSub.publish(responsePubSub, Devtools.Disconnect.make({ liveStoreVersion, appHostId }))),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    const sendToAppHost: Devtools.PrepareDevtoolsBridge['sendToAppHost'] = (msg) =>
      Effect.gen(function* () {
        // NOTE it's possible that a message is for both the coordinator and the store (e.g. Disconnect)
        if (Schema.is(Devtools.MessageToAppLeader)(msg)) {
          yield* nodeDevtoolsChannelCoordinator.send(msg)
        }

        if (Schema.is(Devtools.MessageToAppClientSession)(msg)) {
          yield* nodeDevtoolsChannelStore.send(msg)
        }
      }).pipe(Effect.withSpan('sendToAppHost'), Effect.orDie)

    const copyToClipboard = (text: string) =>
      Effect.sync(() => {
        navigator.clipboard.writeText(text)
      })

    return {
      responsePubSub,
      sendToAppHost,
      appHostId,
      copyToClipboard,
      isLeader,
    } satisfies Devtools.PrepareDevtoolsBridge
  }).pipe(Effect.orDie)
