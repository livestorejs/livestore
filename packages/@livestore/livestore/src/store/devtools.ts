import type { DebugInfo, SyncState } from '@livestore/common'
import { Devtools, liveStoreVersion, UnknownError } from '@livestore/common'
import { throttle } from '@livestore/utils'
import type { WebChannel } from '@livestore/utils/effect'
import { Effect, Stream } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import { NOT_REFRESHED_YET } from '../reactive.ts'
import { emptyDebugInfo as makeEmptyDebugInfo } from '../SqliteDbWrapper.ts'
import type { Store } from './store.ts'
import { StoreInternalsSymbol } from './store-types.ts'

type Unsub = () => void
type RequestId = string
type SubMap = Map<RequestId, Unsub>

// When running this code in Node.js, we need to use `setTimeout` instead of `requestAnimationFrame`
const requestNextTick: (cb: () => void) => number =
  globalThis.requestAnimationFrame === undefined
    ? (cb: () => void) => setTimeout(cb, 1000) as unknown as number
    : globalThis.requestAnimationFrame

const cancelTick: (id: number) => void =
  globalThis.cancelAnimationFrame === undefined ? (id: number) => clearTimeout(id) : globalThis.cancelAnimationFrame

export const connectDevtoolsToStore = ({
  storeDevtoolsChannel,
  store,
}: {
  storeDevtoolsChannel: WebChannel.WebChannel<
    Devtools.ClientSession.MessageToApp,
    Devtools.ClientSession.MessageFromApp
  >
  store: Store
}) =>
  Effect.gen(function* () {
    const reactivityGraphSubcriptions: SubMap = new Map()
    const liveQueriesSubscriptions: SubMap = new Map()
    const debugInfoHistorySubscriptions: SubMap = new Map()
    const syncHeadClientSessionSubscriptions: SubMap = new Map()

    const { clientId, sessionId } = store[StoreInternalsSymbol].clientSession

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const unsub of reactivityGraphSubcriptions.values()) unsub()
        for (const unsub of liveQueriesSubscriptions.values()) unsub()
        for (const unsub of debugInfoHistorySubscriptions.values()) unsub()
        for (const unsub of syncHeadClientSessionSubscriptions.values()) unsub()
      }),
    )

    const handledRequestIds = new Set<RequestId>()

    const sendToDevtools = (message: Devtools.ClientSession.MessageFromApp) =>
      storeDevtoolsChannel.send(message).pipe(Effect.tapCauseLogPretty, Effect.runFork)

    const onMessage = (decodedMessage: typeof Devtools.ClientSession.MessageToApp.Type) => {
      // console.debug('@livestore/livestore:store:devtools:onMessage', decodedMessage)

      if (decodedMessage.clientId !== clientId || decodedMessage.sessionId !== sessionId) {
        // console.log(`Unknown message`, event)
        return
      }

      if (decodedMessage._tag === 'LSD.ClientSession.Disconnect') {
        // Gracefully tear down all DevTools subscriptions and close the channel.
        // This prevents background fibers from lingering after DevTools closes
        // (e.g. when a window is closed without sending explicit unsubs).
        for (const unsub of reactivityGraphSubcriptions.values()) unsub()
        reactivityGraphSubcriptions.clear()
        for (const unsub of liveQueriesSubscriptions.values()) unsub()
        liveQueriesSubscriptions.clear()
        for (const unsub of debugInfoHistorySubscriptions.values()) unsub()
        debugInfoHistorySubscriptions.clear()
        for (const unsub of syncHeadClientSessionSubscriptions.values()) unsub()
        syncHeadClientSessionSubscriptions.clear()

        // Signal the WebChannel to shut down; this causes the `listen` stream
        // to complete and allows the surrounding scoped fiber to exit.
        storeDevtoolsChannel.shutdown.pipe(Effect.runFork)
        return
      }

      const requestId = decodedMessage.requestId

      // TODO we should try to move the duplicate message handling on the webmesh layer
      // So far I could only observe this problem with webmesh proxy channels (e.g. for Expo)
      // Proof: https://share.cleanshot.com/V9G87B0B
      // Also see `leader-worker-devtools.ts` for same problem
      if (handledRequestIds.has(requestId)) {
        return
      }

      handledRequestIds.add(requestId)

      const requestIdleCallback = globalThis.requestIdleCallback ?? ((cb: () => void) => cb())

      switch (decodedMessage._tag) {
        case 'LSD.ClientSession.ReactivityGraphSubscribe': {
          const includeResults = decodedMessage.includeResults
          const { subscriptionId } = decodedMessage

          const send = () =>
            // In order to not add more work to the current tick, we use requestIdleCallback
            // to send the reactivity graph updates to the devtools
            requestIdleCallback(
              () =>
                sendToDevtools(
                  Devtools.ClientSession.ReactivityGraphRes.make({
                    reactivityGraph: store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults }),
                    requestId: nanoid(10),
                    clientId,
                    sessionId,
                    liveStoreVersion,
                    subscriptionId,
                  }),
                ),
              { timeout: 500 },
            )

          send()

          // In some cases, there can be A LOT of reactivity graph updates in a short period of time
          // so we throttle the updates to avoid sending too much data
          // This might need to be tweaked further and possibly be exposed to the user in some way.
          const throttledSend = throttle(send, 20)

          reactivityGraphSubcriptions.set(
            subscriptionId,
            store[StoreInternalsSymbol].reactivityGraph.subscribeToRefresh(throttledSend),
          )

          break
        }
        case 'LSD.ClientSession.DebugInfoReq': {
          sendToDevtools(
            Devtools.ClientSession.DebugInfoRes.make({
              debugInfo: store[StoreInternalsSymbol].sqliteDbWrapper.debugInfo,
              requestId,
              clientId,
              sessionId,
              liveStoreVersion,
            }),
          )
          break
        }
        case 'LSD.ClientSession.DebugInfoHistorySubscribe': {
          const { subscriptionId } = decodedMessage
          const buffer: DebugInfo[] = []
          let hasStopped = false
          let tickHandle: number | undefined

          const tick = () => {
            buffer.push(store[StoreInternalsSymbol].sqliteDbWrapper.debugInfo)

            // NOTE this resets the debug info, so all other "readers" e.g. in other `requestAnimationFrame` loops,
            // will get the empty debug info
            // TODO We need to come up with a more graceful way to do store. Probably via a single global
            // `requestAnimationFrame` loop that is passed in somehow.
            store[StoreInternalsSymbol].sqliteDbWrapper.debugInfo = makeEmptyDebugInfo()

            if (buffer.length > 10) {
              sendToDevtools(
                Devtools.ClientSession.DebugInfoHistoryRes.make({
                  debugInfoHistory: buffer,
                  requestId: nanoid(10),
                  clientId,
                  sessionId,
                  liveStoreVersion,
                  subscriptionId,
                }),
              )
              buffer.length = 0
            }

            if (hasStopped === false) {
              tickHandle = requestNextTick(tick)
            }
          }

          tickHandle = requestNextTick(tick)

          const unsub = () => {
            hasStopped = true
            if (tickHandle !== undefined) {
              cancelTick(tickHandle)
              tickHandle = undefined
            }
          }

          debugInfoHistorySubscriptions.set(subscriptionId, unsub)

          break
        }
        case 'LSD.ClientSession.DebugInfoHistoryUnsubscribe': {
          const { subscriptionId } = decodedMessage
          // NOTE given Webmesh channels have persistent retry behaviour, it can happen that a previous
          // Webmesh channel will send a unsubscribe message for an old requestId. Thus the `?.()` handling.
          debugInfoHistorySubscriptions.get(subscriptionId)?.()
          debugInfoHistorySubscriptions.delete(subscriptionId)
          break
        }
        case 'LSD.ClientSession.DebugInfoResetReq': {
          store[StoreInternalsSymbol].sqliteDbWrapper.debugInfo.slowQueries.clear()
          sendToDevtools(
            Devtools.ClientSession.DebugInfoResetRes.make({ requestId, clientId, sessionId, liveStoreVersion }),
          )
          break
        }
        case 'LSD.ClientSession.DebugInfoRerunQueryReq': {
          const { queryStr, bindValues, queriedTables } = decodedMessage
          store[StoreInternalsSymbol].sqliteDbWrapper.cachedSelect(queryStr, bindValues, {
            queriedTables,
            skipCache: true,
          })
          sendToDevtools(
            Devtools.ClientSession.DebugInfoRerunQueryRes.make({ requestId, clientId, sessionId, liveStoreVersion }),
          )
          break
        }
        case 'LSD.ClientSession.ReactivityGraphUnsubscribe': {
          const { subscriptionId } = decodedMessage
          // NOTE given Webmesh channels have persistent retry behaviour, it can happen that a previous
          // Webmesh channel will send a unsubscribe message for an old requestId. Thus the `?.()` handling.
          reactivityGraphSubcriptions.get(subscriptionId)?.()
          reactivityGraphSubcriptions.delete(subscriptionId)
          break
        }
        case 'LSD.ClientSession.LiveQueriesSubscribe': {
          const { subscriptionId } = decodedMessage
          const send = () =>
            requestIdleCallback(
              () =>
                sendToDevtools(
                  Devtools.ClientSession.LiveQueriesRes.make({
                    liveQueries: [...store[StoreInternalsSymbol].activeQueries].map((q) => ({
                      _tag: q._tag,
                      id: q.id,
                      label: q.label,
                      hash: q.def.hash,
                      runs: q.runs,
                      executionTimes: q.executionTimes.map((_) => Number(_.toString().slice(0, 5))),
                      lastestResult:
                        q.results$.previousResult === NOT_REFRESHED_YET
                          ? 'SYMBOL_NOT_REFRESHED_YET'
                          : q.results$.previousResult,
                      activeSubscriptions: Array.from(q.activeSubscriptions),
                    })),
                    requestId: nanoid(10),
                    liveStoreVersion,
                    clientId,
                    sessionId,
                    subscriptionId,
                  }),
                ),
              { timeout: 500 },
            )

          send()

          // Same as in the reactivity graph subscription case above, we need to throttle the updates
          const throttledSend = throttle(send, 20)

          liveQueriesSubscriptions.set(
            subscriptionId,
            store[StoreInternalsSymbol].reactivityGraph.subscribeToRefresh(throttledSend),
          )

          break
        }
        case 'LSD.ClientSession.LiveQueriesUnsubscribe': {
          const { subscriptionId } = decodedMessage
          // NOTE given Webmesh channels have persistent retry behaviour, it can happen that a previous
          // Webmesh channel will send a unsubscribe message for an old requestId. Thus the `?.()` handling.
          liveQueriesSubscriptions.get(subscriptionId)?.()
          liveQueriesSubscriptions.delete(subscriptionId)
          break
        }
        case 'LSD.ClientSession.SyncHeadSubscribe': {
          const { subscriptionId } = decodedMessage
          const send = (syncState: SyncState.SyncState) =>
            sendToDevtools(
              Devtools.ClientSession.SyncHeadRes.make({
                local: syncState.localHead,
                upstream: syncState.upstreamHead,
                requestId: nanoid(10),
                clientId,
                sessionId,
                liveStoreVersion,
                subscriptionId,
              }),
            )

          send(store[StoreInternalsSymbol].syncProcessor.syncState.pipe(Effect.runSync))

          syncHeadClientSessionSubscriptions.set(
            subscriptionId,
            store[StoreInternalsSymbol].syncProcessor.syncState.changes.pipe(
              Stream.tap((syncState) => send(syncState)),
              Stream.runDrain,
              Effect.interruptible,
              Effect.tapCauseLogPretty,
              Effect.runCallback,
            ),
          )

          break
        }
        case 'LSD.ClientSession.SyncHeadUnsubscribe': {
          const { subscriptionId } = decodedMessage
          // NOTE given Webmesh channels have persistent retry behaviour, it can happen that a previous
          // Webmesh channel will send a unsubscribe message for an old requestId. Thus the `?.()` handling.
          syncHeadClientSessionSubscriptions.get(subscriptionId)?.()
          syncHeadClientSessionSubscriptions.delete(subscriptionId)
          break
        }
        case 'LSD.ClientSession.Ping': {
          sendToDevtools(Devtools.ClientSession.Pong.make({ requestId, clientId, sessionId, liveStoreVersion }))
          break
        }
        default: {
          console.warn(`[LSD.ClientSession] Unknown message`, decodedMessage)
        }
      }
    }

    yield* storeDevtoolsChannel.listen.pipe(
      // Stream.tapLogWithLabel('@livestore/livestore:store:devtools:onMessage'),
      Stream.flatten(),
      Stream.tapSync((message) => onMessage(message)),
      Stream.runDrain,
      Effect.withSpan('LSD.devtools.onMessage'),
    )
  }).pipe(UnknownError.mapToUnknownError, Effect.withSpan('LSD.devtools.connectStoreToDevtools'))
