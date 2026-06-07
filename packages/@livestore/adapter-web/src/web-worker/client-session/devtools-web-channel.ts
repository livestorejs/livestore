import { Devtools } from '@livestore/common'
import type { Scope, WebChannel } from '@livestore/utils/effect'
import { Effect, Schema } from '@livestore/utils/effect'
import { WebChannelBrowser } from '@livestore/utils/effect/browser'

export const makeSessionInfoBroadcastChannel: Effect.Effect<
  WebChannel.WebChannel<Devtools.SessionInfo.Message, Devtools.SessionInfo.Message>,
  never,
  Scope.Scope
> = WebChannelBrowser.broadcastChannel({
  channelName: 'session-info',
  schema: Devtools.SessionInfo.Message,
})

export const makeBrowserExtensionNodeName = {
  contentscriptMain: (tabId: number) => `contentscript-main-${tabId}`,
  contentscriptIframe: (tabId: number) => `contentscript-iframe-${tabId}`,
}

export const ClientSessionContentscriptMainReq = Schema.TaggedStruct('ClientSessionContentscriptMainReq', {
  storeId: Schema.String,
  clientId: Schema.String,
  sessionId: Schema.String,
})

export const ClientSessionContentscriptMainRes = Schema.TaggedStruct('ClientSessionContentscriptMainRes', {
  tabId: Schema.Number,
})

export const makeStaticClientSessionChannel: {
  contentscriptMain: Effect.Effect<
    WebChannel.WebChannel<
      typeof ClientSessionContentscriptMainReq.Type,
      typeof ClientSessionContentscriptMainRes.Type
    >,
    never,
    Scope.Scope
  >
  clientSession: Effect.Effect<
    WebChannel.WebChannel<
      typeof ClientSessionContentscriptMainRes.Type,
      typeof ClientSessionContentscriptMainReq.Type
    >,
    never,
    Scope.Scope
  >
} = {
  contentscriptMain: Effect.suspend(() =>
    WebChannelBrowser.windowChannel({
      listenWindow: window,
      sendWindow: window,
      schema: { listen: ClientSessionContentscriptMainReq, send: ClientSessionContentscriptMainRes },
      ids: { own: 'contentscript-main-static', other: 'client-session-static' },
    }),
  ),
  clientSession: Effect.suspend(() =>
    WebChannelBrowser.windowChannel({
      listenWindow: window,
      sendWindow: window,
      schema: { listen: ClientSessionContentscriptMainRes, send: ClientSessionContentscriptMainReq },
      ids: { own: 'client-session-static', other: 'contentscript-main-static' },
    }),
  ),
}
