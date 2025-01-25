import { Devtools, liveStoreVersion } from '@livestore/common'
import { Deferred, Effect, PubSub, Schema, Stream, WebChannel } from '@livestore/utils/effect'

/**
 * This code is running in the devtools window where it's assumed that message ports
 * can be transferred over the bridge.
 */
export const makeShared = ({
  portForDevtoolsDeferred,
  responsePubSub,
}: {
  portForDevtoolsDeferred: Deferred.Deferred<MessagePort>
  responsePubSub: PubSub.PubSub<Devtools.MessageFromAppLeader | Devtools.MessageFromAppClientSession>
}) =>
  Effect.gen(function* () {
    const appHostInfoDeferred = yield* Deferred.make<{ appHostId: string; isLeader: boolean }>()

    const appHostStoreChannelDeferred =
      yield* Deferred.make<
        WebChannel.WebChannel<
          typeof Devtools.MessageFromAppClientSession.Type,
          typeof Devtools.MessageToAppClientSession.Type
        >
      >()

    const portForDevtools = yield* Deferred.await(portForDevtoolsDeferred)

    const appHostCoordinatorChannel = yield* WebChannel.messagePortChannel({
      port: portForDevtools,
      schema: { listen: Devtools.MessageFromAppLeader, send: Devtools.MessageToAppLeader },
    })

    yield* appHostCoordinatorChannel.listen.pipe(
      Stream.flatten(),
      // Stream.tapLogWithLabel('appHostCoordinatorChannel.listen'),
      Stream.tap((msg) =>
        Effect.gen(function* () {
          // if (msg._tag === 'LSD.AppHostReady') {
          // const { appHostId, isLeader } = msg
          // yield* Deferred.succeed(appHostInfoDeferred, { appHostId, isLeader })
          // } else if (msg._tag === 'LSD.MessagePortForStoreReq') {
          // Here we're "duplicating" the message port since we need one for the coordinator
          // and one for the store
          const storeMessageChannel = new MessageChannel()

          // yield* sendToAppHost(
          //   Devtools.MessagePortForStoreRes.make({
          //     // appHostId: msg.appHostId,
          //     liveStoreVersion: msg.liveStoreVersion,
          //     port: storeMessageChannel.port1,
          //     requestId: msg.requestId,
          //   }),
          // )

          //   const portForAppHostStoreChannel = yield* WebChannel.messagePortChannel({
          //     port: storeMessageChannel.port2,
          //     schema: { listen: Devtools.MessageFromAppClientSession, send: Devtools.MessageToAppClientSession },
          //   })

          //   yield* portForAppHostStoreChannel.listen.pipe(
          //     Stream.flatten(),
          //     Stream.tap((msg) => PubSub.publish(responsePubSub, msg)),
          //     Stream.runDrain,
          //     Effect.withSpan('portForStoreChannel.listen'),
          //     Effect.tapCauseLogPretty,
          //     Effect.forkScoped,
          //   )

          //   yield* Deferred.succeed(appHostStoreChannelDeferred, portForAppHostStoreChannel)
          // } else {
          yield* PubSub.publish(responsePubSub, msg)
          // }
        }),
      ),
      Stream.runDrain,
      Effect.withSpan('portForDevtoolsChannel.listen'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    // Sends the message to the app host (i.e. contentscript) via the devtools panel window and the background script
    const sendToAppHost: Devtools.PrepareDevtoolsBridge['sendToAppHost'] = (msg) =>
      Effect.gen(function* () {
        // console.log('bridge-shared: sendToAppHost', msg)
        if (Schema.is(Devtools.MessageToAppLeader)(msg)) {
          yield* appHostCoordinatorChannel.send(msg)
        } else {
          // console.log('bridge-shared: sendToAppHostStore', msg)
          const appHostStoreChannel = yield* Deferred.await(appHostStoreChannelDeferred)
          yield* appHostStoreChannel.send(msg)
        }
      }).pipe(Effect.withSpan('sendToAppHost'), Effect.orDie)

    // yield* sendToAppHost(Devtools.DevtoolsReady.make({ liveStoreVersion }))

    const { appHostId, isLeader } = yield* Deferred.await(appHostInfoDeferred)

    return { sendToAppHost, appHostId, isLeader }
  })
