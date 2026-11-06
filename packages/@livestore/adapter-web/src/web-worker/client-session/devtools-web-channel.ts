import { Devtools } from '@livestore/common'
import { type Scope, type WebChannel, Effect, Schema, Stream } from '@livestore/utils/effect'
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
  tabId: Schema.Finite,
})

/** Announces listener availability, not a response to a particular session's request. */
export const ContentscriptMainReady = Schema.TaggedStruct('ContentscriptMainReady', {})
export const ContentscriptMainMessage = Schema.Union([ClientSessionContentscriptMainRes, ContentscriptMainReady])

/**
 * Either endpoint can start first. The initial request also supports older extensions
 * that do not announce readiness; the announcement recovers a request sent before injection.
 */
export const requestContentscriptMain = Effect.fn(function* (
  channel: WebChannel.WebChannel<typeof ContentscriptMainMessage.Type, typeof ClientSessionContentscriptMainReq.Type>,
  session: typeof ClientSessionContentscriptMainReq.Type,
) {
  yield* channel.send(session)
  return yield* channel.listen.pipe(
    Stream.mapEffect(Effect.fromResult),
    Stream.tap((message) => (message._tag === 'ContentscriptMainReady' ? channel.send(session) : Effect.void)),
    Stream.filter(Schema.is(ClientSessionContentscriptMainRes)),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
  )
})

export const makeStaticClientSessionChannel: {
  contentscriptMain: Effect.Effect<
    WebChannel.WebChannel<typeof ClientSessionContentscriptMainReq.Type, typeof ContentscriptMainMessage.Type>,
    never,
    Scope.Scope
  >
  clientSession: Effect.Effect<
    WebChannel.WebChannel<typeof ContentscriptMainMessage.Type, typeof ClientSessionContentscriptMainReq.Type>,
    never,
    Scope.Scope
  >
} = {
  contentscriptMain: Effect.suspend(() =>
    WebChannelBrowser.windowChannel({
      listenWindow: window,
      sendWindow: window,
      schema: { listen: ClientSessionContentscriptMainReq, send: ContentscriptMainMessage },
      ids: { own: 'contentscript-main-static', other: 'client-session-static' },
    }),
  ),
  clientSession: Effect.suspend(() =>
    WebChannelBrowser.windowChannel({
      listenWindow: window,
      sendWindow: window,
      schema: { listen: ContentscriptMainMessage, send: ClientSessionContentscriptMainReq },
      ids: { own: 'client-session-static', other: 'contentscript-main-static' },
    }),
  ),
}
