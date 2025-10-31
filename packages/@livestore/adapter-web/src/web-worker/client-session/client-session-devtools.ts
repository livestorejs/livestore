import { Devtools, liveStoreVersion } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import * as DevtoolsWeb from '@livestore/devtools-web-common/web-channel'
import { isDevEnv } from '@livestore/utils'
import type { Worker } from '@livestore/utils/effect'
import { Effect, Stream, WebChannel } from '@livestore/utils/effect'
import * as Webmesh from '@livestore/webmesh'

export const logDevtoolsUrl = ({
  schema,
  storeId,
  clientId,
  sessionId,
}: {
  schema: LiveStoreSchema
  storeId: string
  clientId: string
  sessionId: string
}) =>
  Effect.gen(function* () {
    if (isDevEnv()) {
      const devtoolsPath = globalThis.LIVESTORE_DEVTOOLS_PATH ?? `/_livestore`
      const devtoolsBaseUrl = `${location.origin}${devtoolsPath}`

      // Check whether devtools are available and then log the URL
      const response = yield* Effect.promise(() => fetch(devtoolsBaseUrl))
      if (response.ok) {
        const text = yield* Effect.promise(() => response.text())
        if (text.includes('<meta name="livestore-devtools" content="true" />')) {
          const url = `${devtoolsBaseUrl}/web/${storeId}/${clientId}/${sessionId}/${schema.devtools.alias}`
          yield* Effect.log(`[@livestore/adapter-web] Devtools ready on ${url}`)
        }

        // Check for DevTools Chrome extension presence via iframe container the extension injects
        const hasExt = document.querySelector('[id^="livestore-devtools-iframe-"]') !== null
        if (!hasExt) {
          const g = globalThis as { __livestoreDevtoolsChromeNoticeShown?: boolean }
          if (g.__livestoreDevtoolsChromeNoticeShown !== true) {
            g.__livestoreDevtoolsChromeNoticeShown = true

            const urlToLog = `https://github.com/livestorejs/livestore/releases/download/v${liveStoreVersion}/livestore-devtools-chrome-${liveStoreVersion}.zip`
            yield* Effect.log(
              `[@livestore/adapter-web] LiveStore DevTools Chrome extension not detected. Install v${liveStoreVersion}: ${urlToLog}`,
            )
          }
        }
      }
    }
  }).pipe(Effect.withSpan('@livestore/adapter-web:client-session:devtools:logDevtoolsUrl'))

export const connectWebmeshNodeClientSession = Effect.fn(function* ({
  webmeshNode,
  sessionInfo,
  sharedWorker,
  devtoolsEnabled,
  schema,
}: {
  webmeshNode: Webmesh.MeshNode
  sessionInfo: Devtools.SessionInfo.SessionInfo
  sharedWorker: Worker.SerializedWorkerPool<typeof DevtoolsWeb.WorkerSchema.Request.Type>
  devtoolsEnabled: boolean
  schema: LiveStoreSchema
}) {
  if (devtoolsEnabled) {
    const { clientId, sessionId, storeId } = sessionInfo
    yield* logDevtoolsUrl({ clientId, sessionId, schema, storeId })

    // This additional sessioninfo broadcast channel is needed since we can't use the shared worker
    // as it's currently storeId-specific
    yield* Devtools.SessionInfo.provideSessionInfo({
      webChannel: yield* DevtoolsWeb.makeSessionInfoBroadcastChannel,
      sessionInfo,
    }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

    yield* Effect.gen(function* () {
      const clientSessionStaticChannel = yield* DevtoolsWeb.makeStaticClientSessionChannel.clientSession

      yield* clientSessionStaticChannel.send(
        DevtoolsWeb.ClientSessionContentscriptMainReq.make({ clientId, sessionId, storeId }),
      )

      const { tabId } = yield* clientSessionStaticChannel.listen.pipe(Stream.flatten(), Stream.runHead, Effect.flatten)

      const contentscriptMainNodeName = DevtoolsWeb.makeNodeName.browserExtension.contentscriptMain(tabId)

      const contentscriptMainChannel = yield* WebChannel.windowChannel({
        listenWindow: window,
        sendWindow: window,
        schema: Webmesh.WebmeshSchema.Packet,
        ids: { own: webmeshNode.nodeName, other: contentscriptMainNodeName },
      })

      yield* webmeshNode.addEdge({ target: contentscriptMainNodeName, edgeChannel: contentscriptMainChannel })
    }).pipe(
      Effect.withSpan('@livestore/adapter-web:client-session:devtools:browser-extension'),
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* DevtoolsWeb.connectViaWorker({
      node: webmeshNode,
      target: DevtoolsWeb.makeNodeName.sharedWorker({ storeId }),
      worker: sharedWorker,
    })
  }
})
