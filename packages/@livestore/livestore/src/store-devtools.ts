import type { DebugInfo, StoreAdapter } from '@livestore/common'
import { Devtools, liveStoreVersion } from '@livestore/common'
import { throttle } from '@livestore/utils'
import { BrowserChannel, Effect, Either, Runtime, Schema, Stream } from '@livestore/utils/effect'

import type { MainDatabaseWrapper } from './MainDatabaseWrapper.js'
import { emptyDebugInfo as makeEmptyDebugInfo } from './MainDatabaseWrapper.js'
import { NOT_REFRESHED_YET } from './reactive.js'
import type { LiveQuery, ReactivityGraph } from './reactiveQueries/base-class.js'
import type { ReferenceCountedSet } from './utils/data-structures.js'

type IStore = {
  adapter: StoreAdapter
  devtoolsConnectionId: string
  reactivityGraph: ReactivityGraph
  mainDbWrapper: MainDatabaseWrapper
  activeQueries: ReferenceCountedSet<LiveQuery<any>>
}

export const listenToWebBridge = ({ store }: { store: IStore }) =>
  Effect.gen(function* () {
    const channelId = store.adapter.coordinator.devtools.channelId

    const webBridgeBroadcastChannel = yield* Devtools.WebBridge.makeBroadcastChannel()

    yield* webBridgeBroadcastChannel.send(Devtools.WebBridge.AppHostReady.make({ channelId }))

    const runtime = yield* Effect.runtime()

    window.addEventListener('beforeunload', () =>
      webBridgeBroadcastChannel
        .send(Devtools.WebBridge.AppHostWillDisconnect.make({ channelId }))
        .pipe(Runtime.runFork(runtime)),
    )

    yield* webBridgeBroadcastChannel.listen.pipe(
      Stream.flatten(),
      Stream.filter(Schema.is(Devtools.WebBridge.DevtoolsReady)),
      Stream.tap(() => webBridgeBroadcastChannel.send(Devtools.WebBridge.AppHostReady.make({ channelId }))),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* store.adapter.coordinator.devtools.waitForPort.pipe(
      Effect.tap((port) => connectStoreToDevtools({ port, store }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)),
      Effect.forever, // Repeat in case devtools disconnects
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )
  })

export const listenToBrowserExtensionBridge = ({ store }: { store: IStore }) =>
  Effect.gen(function* () {
    const channelId = store.adapter.coordinator.devtools.channelId

    const windowChannel = yield* BrowserChannel.windowChannel({
      window,
      listenSchema: Devtools.DevtoolsWindowMessage.MessageForStore,
      sendSchema: Devtools.DevtoolsWindowMessage.MessageForContentscript,
    })

    yield* windowChannel.send(Devtools.DevtoolsWindowMessage.LoadIframe.make({}))

    yield* windowChannel.listen.pipe(
      Stream.filterMap(Either.getRight),
      Stream.tap((message) =>
        Effect.gen(function* () {
          if (message._tag === 'LSD.WindowMessage.ContentscriptListening') {
            // Send message to contentscript via window (which the contentscript iframe is listening to)
            yield* windowChannel.send(Devtools.DevtoolsWindowMessage.StoreReady.make({ channelId }))
            return
          }

          if (message.channelId !== channelId) return

          if (message._tag === 'LSD.WindowMessage.MessagePortForStore') {
            yield* connectStoreToDevtools({ port: message.port, store })
          }
        }),
      ),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    yield* windowChannel.send(Devtools.DevtoolsWindowMessage.StoreReady.make({ channelId }))
  })

type Unsub = () => void
type RequestId = string
type SubMap = Map<RequestId, Unsub>

const connectStoreToDevtools = ({ port, store }: { port: MessagePort; store: IStore }) =>
  Effect.gen(function* () {
    const channelId = store.adapter.coordinator.devtools.channelId

    const reactivityGraphSubcriptions: SubMap = new Map()
    const liveQueriesSubscriptions: SubMap = new Map()
    const debugInfoHistorySubscriptions: SubMap = new Map()

    const { storeMessagePort } = yield* store.adapter.coordinator.devtools.connect({
      port,
      connectionId: store.devtoolsConnectionId,
    })

    const storePortChannel = yield* BrowserChannel.messagePortChannel({
      port: storeMessagePort,
      listenSchema: Devtools.MessageToAppHostStore,
      sendSchema: Devtools.MessageFromAppHostStore,
    })

    const sendToDevtools = (message: Devtools.MessageFromAppHostStore) =>
      storePortChannel.send(message).pipe(Effect.tapCauseLogPretty, Effect.runSync)

    const onMessage = (decodedMessage: typeof Devtools.MessageToAppHostStore.Type) => {
      // console.log('storeMessagePort message', decodedMessage)

      if (decodedMessage.channelId !== store.adapter.coordinator.devtools.channelId) {
        // console.log(`Unknown message`, event)
        return
      }

      const requestId = decodedMessage.requestId

      const requestIdleCallback = window.requestIdleCallback ?? ((cb: Function) => cb())

      switch (decodedMessage._tag) {
        case 'LSD.ReactivityGraphSubscribe': {
          const includeResults = decodedMessage.includeResults

          const send = () =>
            // In order to not add more work to the current tick, we use requestIdleCallback
            // to send the reactivity graph updates to the devtools
            requestIdleCallback(
              () =>
                sendToDevtools(
                  Devtools.ReactivityGraphRes.make({
                    reactivityGraph: store.reactivityGraph.getSnapshot({ includeResults }),
                    requestId,
                    channelId,
                    liveStoreVersion,
                  }),
                ),
              { timeout: 500 },
            )

          send()

          // In some cases, there can be A LOT of reactivity graph updates in a short period of time
          // so we throttle the updates to avoid sending too much data
          // This might need to be tweaked further and possibly be exposed to the user in some way.
          const throttledSend = throttle(send, 20)

          reactivityGraphSubcriptions.set(requestId, store.reactivityGraph.subscribeToRefresh(throttledSend))

          break
        }
        case 'LSD.DebugInfoReq': {
          sendToDevtools(
            Devtools.DebugInfoRes.make({
              debugInfo: store.mainDbWrapper.debugInfo,
              requestId,
              channelId,
              liveStoreVersion,
            }),
          )
          break
        }
        case 'LSD.DebugInfoHistorySubscribe': {
          const buffer: DebugInfo[] = []
          let hasStopped = false
          let rafHandle: number | undefined

          const tick = () => {
            buffer.push(store.mainDbWrapper.debugInfo)

            // NOTE this resets the debug info, so all other "readers" e.g. in other `requestAnimationFrame` loops,
            // will get the empty debug info
            // TODO We need to come up with a more graceful way to do store. Probably via a single global
            // `requestAnimationFrame` loop that is passed in somehow.
            store.mainDbWrapper.debugInfo = makeEmptyDebugInfo()

            if (buffer.length > 10) {
              sendToDevtools(
                Devtools.DebugInfoHistoryRes.make({
                  debugInfoHistory: buffer,
                  requestId,
                  channelId,
                  liveStoreVersion,
                }),
              )
              buffer.length = 0
            }

            if (hasStopped === false) {
              rafHandle = requestAnimationFrame(tick)
            }
          }

          rafHandle = requestAnimationFrame(tick)

          const unsub = () => {
            hasStopped = true
            if (rafHandle !== undefined) {
              cancelAnimationFrame(rafHandle)
            }
          }

          debugInfoHistorySubscriptions.set(requestId, unsub)

          break
        }
        case 'LSD.DebugInfoHistoryUnsubscribe': {
          debugInfoHistorySubscriptions.get(requestId)!()
          debugInfoHistorySubscriptions.delete(requestId)
          break
        }
        case 'LSD.DebugInfoResetReq': {
          store.mainDbWrapper.debugInfo.slowQueries.clear()
          sendToDevtools(Devtools.DebugInfoResetRes.make({ requestId, channelId, liveStoreVersion }))
          break
        }
        case 'LSD.DebugInfoRerunQueryReq': {
          const { queryStr, bindValues, queriedTables } = decodedMessage
          store.mainDbWrapper.select(queryStr, { bindValues, queriedTables, skipCache: true })
          sendToDevtools(Devtools.DebugInfoRerunQueryRes.make({ requestId, channelId, liveStoreVersion }))
          break
        }
        case 'LSD.ReactivityGraphUnsubscribe': {
          reactivityGraphSubcriptions.get(requestId)!()
          break
        }
        case 'LSD.LiveQueriesSubscribe': {
          const send = () =>
            requestIdleCallback(
              () =>
                sendToDevtools(
                  Devtools.LiveQueriesRes.make({
                    liveQueries: [...store.activeQueries].map((q) => ({
                      _tag: q._tag,
                      id: q.id,
                      label: q.label,
                      runs: q.runs,
                      executionTimes: q.executionTimes.map((_) => Number(_.toString().slice(0, 5))),
                      lastestResult:
                        q.results$.previousResult === NOT_REFRESHED_YET
                          ? 'SYMBOL_NOT_REFRESHED_YET'
                          : q.results$.previousResult,
                      activeSubscriptions: Array.from(q.activeSubscriptions),
                    })),
                    requestId,
                    liveStoreVersion,
                    channelId,
                  }),
                ),
              { timeout: 500 },
            )

          send()

          // Same as in the reactivity graph subscription case above, we need to throttle the updates
          const throttledSend = throttle(send, 20)

          liveQueriesSubscriptions.set(requestId, store.reactivityGraph.subscribeToRefresh(throttledSend))

          break
        }
        case 'LSD.LiveQueriesUnsubscribe': {
          liveQueriesSubscriptions.get(requestId)!()
          liveQueriesSubscriptions.delete(requestId)
          break
        }
        // No default
      }
    }

    yield* storePortChannel.listen.pipe(
      Stream.flatten(),
      Stream.tapSync((message) => onMessage(message)),
      Stream.runDrain,
      Effect.withSpan('LSD.devtools.onMessage'),
    )
  })
