import type { WebAdapterOptions } from '@livestore/adapter-web'
import { WorkerSchema } from '@livestore/adapter-web'
import { Devtools, liveStoreVersion } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { tryAsFunctionAndNew } from '@livestore/utils'
import type { Deferred, HashSet, Scope, SubscriptionRef } from '@livestore/utils/effect'
import { BrowserWorker, Effect, Equal, FiberSet, Hash, PubSub, Schema, Stream, Worker } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { makeShared } from './bridge-shared.js'

export class WebBridgeInfo extends Schema.Class<WebBridgeInfo>('WebBridgeChannelInfo')({
  appHostId: Schema.String,
  storeId: Schema.String,
  webBridgeId: Schema.String,
  isLeader: Schema.Boolean,
}) {
  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
  [Hash.symbol](): number {
    return Hash.string(this.appHostId)
  }

  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
  [Equal.symbol](that: Equal.Equal): boolean {
    return this.appHostId === (that as WebBridgeInfo).appHostId
  }
}

export type WebBridgeOptions = {
  selectedChannelInfoDeferred: Deferred.Deferred<WebBridgeInfo>
  bridgeInfos: SubscriptionRef.SubscriptionRef<HashSet.HashSet<WebBridgeInfo>>
}

// const prepareWebDevtoolsBridge = (
//   options: {
//     sharedWorker: WebAdapterOptions['sharedWorker']
//     appSchema: LiveStoreSchema
//   } & WebBridgeOptions,
// ): Effect.Effect<Devtools.PrepareDevtoolsBridge, never, Scope.Scope> =>
//   Effect.gen(function* () {
//     const responsePubSub = yield* PubSub.unbounded<
//       Devtools.MessageFromApp | Devtools.MessageFromApp
//     >().pipe(Effect.acquireRelease(PubSub.shutdown))

//     const devtoolsId = nanoid()

//     const portForDevtoolsDeferred = yield* Deferred.make<MessagePort>()

//     const webBridgeBroadcastChannel = yield* Devtools.WebBridge.makeBroadcastChannel()

//     yield* webBridgeBroadcastChannel.listen.pipe(
//       Stream.flatten(),
//       Stream.filter(Schema.is(Devtools.WebBridge.AppHostReady)),
//       Stream.tap(() => webBridgeBroadcastChannel.send(Devtools.WebBridge.DevtoolsReady.make({ devtoolsId }))),
//       Stream.runDrain,
//       Effect.withSpan(`@livestore/adapter-web:devtools:webBridgeChannel:listen`),
//       Effect.ignoreLogged,
//       Effect.forkScoped,
//     )

//     yield* webBridgeBroadcastChannel.send(Devtools.WebBridge.DevtoolsReady.make({ devtoolsId }))

//     const connectionFiberSet = yield* FiberSet.make()

//     yield* webBridgeBroadcastChannel.listen.pipe(
//       Stream.flatten(),
//       Stream.filter(Schema.is(Devtools.WebBridge.ConnectToDevtools)),
//       Stream.tap((msg) =>
//         Effect.gen(function* () {
//           if (devtoolsId !== msg.devtoolsId) return

//           const bridgeInfo = new WebBridgeInfo({
//             appHostId: msg.appHostId,
//             webBridgeId: msg.webBridgeId,
//             isLeader: msg.isLeader,
//             storeId: msg.storeId,
//           })

//           // Propagate disconnect event while connecting.
//           // There's another disconnect handler below after the connection is established.
//           yield* webBridgeBroadcastChannel.listen.pipe(
//             Stream.flatten(),
//             Stream.filter(Schema.is(Devtools.WebBridge.AppHostWillDisconnect)),
//             Stream.filter((msg) => msg.appHostId === bridgeInfo.appHostId),
//             Stream.tap(() => SubscriptionRef.getAndUpdate(options.bridgeInfos, HashSet.remove(bridgeInfo))),
//             Stream.runDrain,
//             Effect.withSpan(`@livestore/adapter-web:devtools:webBridgeChannel:listenForAppHostWillDisconnect`),
//             Effect.tapCauseLogPretty,
//             FiberSet.run(connectionFiberSet),
//           )

//           yield* SubscriptionRef.getAndUpdate(options.bridgeInfos, HashSet.add(bridgeInfo))
//         }),
//       ),
//       Stream.runDrain,
//       Effect.withSpan(`@livestore/adapter-web:devtools:webBridgeChannel:listen`),
//       Effect.tapCauseLogPretty,
//       FiberSet.run(connectionFiberSet),
//     )

//     const selectedChannelInfo = yield* Deferred.await(options.selectedChannelInfoDeferred)

//     const sharedWorker = tryAsFunctionAndNew(options.sharedWorker, {
//       name: `livestore-shared-worker-${selectedChannelInfo.storeId}`,
//     })

//     const sharedWorkerDeferred = yield* Worker.makeSerialized<typeof WorkerSchema.SharedWorker.Request.Type>({
//       initialMessage: () => new WorkerSchema.SharedWorker.InitialMessage({ payload: { _tag: 'FromWebBridge' } }),
//     }).pipe(
//       Effect.provide(BrowserWorker.layer(() => sharedWorker)),
//       Effect.tapCauseLogPretty,
//       Effect.withSpan('@livestore/adapter-web:coordinator:setupSharedWorker'),
//       Effect.toForkedDeferred,
//     )

//     yield* Effect.gen(function* () {
//       const mc = new MessageChannel()

//       const worker = yield* Deferred.await(sharedWorkerDeferred)
//       yield* worker.executeEffect(
//         new WorkerSchema.SharedWorker.DevtoolsWebBridgeOfferPort({
//           port: mc.port1,
//           webBridgeId: selectedChannelInfo.webBridgeId,
//         }),
//       )

//       yield* Deferred.succeed(portForDevtoolsDeferred, mc.port2)

//       // Stop listening for new connections and close `AppHostWillDisconnect` listeners
//       yield* FiberSet.clear(connectionFiberSet)
//     }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

//     const { sendToAppHost, appHostId, isLeader } = yield* makeShared({ portForDevtoolsDeferred, responsePubSub })

//     // NOTE we need a second listener here since we depend on the `appHostId` to be set
//     yield* webBridgeBroadcastChannel.listen.pipe(
//       Stream.flatten(),
//       Stream.filter(Schema.is(Devtools.WebBridge.AppHostWillDisconnect)),
//       Stream.filter((msg) => msg.appHostId === appHostId),
//       Stream.tap(() => SubscriptionRef.getAndUpdate(options.bridgeInfos, HashSet.remove(selectedChannelInfo))),
//       Stream.tap(() => PubSub.publish(responsePubSub, Devtools.Disconnect.make({ appHostId, liveStoreVersion }))),
//       Stream.runDrain,
//       Effect.withSpan(`@livestore/adapter-web:devtools:webBridgeChannel:listenForAppHostWillDisconnect`),
//       Effect.ignoreLogged,
//       Effect.forkScoped,
//     )

//     // NOTE this is not guaranteed to "go through" to the app host but at least we try 🤷
//     yield* Stream.fromEventListener(window, 'beforeunload').pipe(
//       Stream.tap(() => sendToAppHost(Devtools.Disconnect.make({ appHostId, liveStoreVersion }))),
//       Stream.runDrain,
//       Effect.ignoreLogged,
//       Effect.forkScoped,
//     )

//     const copyToClipboard = (text: string) =>
//       Effect.sync(() => {
//         navigator.clipboard.writeText(text)
//       })

//     return {
//       responsePubSub,
//       sendToAppHost,
//       appHostId,
//       copyToClipboard,
//       sendEscapeKey: Effect.void,
//       isLeader,
//     } satisfies Devtools.PrepareDevtoolsBridge
//   }).pipe(Effect.orDie)
