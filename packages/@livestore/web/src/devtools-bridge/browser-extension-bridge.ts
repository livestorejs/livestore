import { Devtools, liveStoreVersion } from '@livestore/common'
import { Deferred, Effect, PubSub, Schema, Stream, WebChannel } from '@livestore/utils/effect'

import type { PrepareDevtoolsBridge } from '../../../common/dist/devtools/devtools-api.js'
import { BackgroundMessage, MessagePortInit } from './background-message.js'
import { makeShared } from './bridge-shared.js'
import { EscapeKey, IframeReady, MessageToPanel } from './iframe-message.js'

// NOTE this code is running inside the devtools iframe, so will be re-running from scratch if the iframe is reloaded
// TODO make sure this also works reliably for HMR
export const prepareBrowserExtensionDevtoolsBridge = Effect.gen(function* () {
  const iframeWindow = window

  const iframeChannel = yield* WebChannel.windowChannel({
    window: iframeWindow,
    listenSchema: Schema.Union(MessagePortInit.PortForDevtools, BackgroundMessage.Disconnect),
    sendSchema: Schema.Never,
  })

  const panelChannel = yield* WebChannel.windowChannel({
    window: iframeWindow.parent,
    listenSchema: Schema.Never,
    sendSchema: MessageToPanel,
  })

  const responsePubSub = yield* PubSub.unbounded<
    Devtools.MessageFromAppHostCoordinator | Devtools.MessageFromAppHostStore
  >().pipe(Effect.acquireRelease(PubSub.shutdown))

  const portForDevtoolsDeferred = yield* Deferred.make<MessagePort>()

  // Messages coming from the app host (i.e. contentscript) via the background script and the devtools panel window
  yield* iframeChannel.listen.pipe(
    Stream.flatten(),
    Stream.tap((msg) =>
      Effect.gen(function* () {
        if (msg._tag === 'MessagePortInit.PortForDevtools') {
          yield* Deferred.succeed(portForDevtoolsDeferred, msg.port)
        } else {
          yield* PubSub.publish(
            responsePubSub,
            Devtools.Disconnect.make({ channelId: msg.channelId, liveStoreVersion }),
          )
        }
      }),
    ),
    Stream.runDrain,
    Effect.withSpan('iframeChannel.listen'),
    Effect.tapCauseLogPretty,
    Effect.forkScoped,
  )

  yield* panelChannel.send(IframeReady.make({})).pipe(Effect.ignoreLogged)

  // NOTE When using the web bridge and browser extension bridge at the same time, both will show `isLeaderTab: true`
  // even though the page origin is the same, given the browser extension app is running in an iframe
  // this will cause the origin to be "sandboxed" and thus the locks be isolated
  const { sendToAppHost, channelId, isLeaderTab } = yield* makeShared({ portForDevtoolsDeferred, responsePubSub })

  const copyToClipboard = (text: string) =>
    panelChannel.send(BackgroundMessage.CopyToClipboard.make({ text })).pipe(Effect.ignoreLogged)

  const sendEscapeKey = panelChannel.send(EscapeKey.make({})).pipe(Effect.ignoreLogged)

  return {
    responsePubSub,
    sendToAppHost,
    channelId,
    copyToClipboard,
    sendEscapeKey,
    isLeaderTab,
  } satisfies PrepareDevtoolsBridge
})
