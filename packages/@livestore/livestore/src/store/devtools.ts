import type { ClientSession, DebugInfo } from '@livestore/common'
import { Devtools, liveStoreVersion, UnexpectedError } from '@livestore/common'
import { throttle } from '@livestore/utils'
import type { WebChannel } from '@livestore/utils/effect'
import { Effect, Stream } from '@livestore/utils/effect'

import type { LiveQuery, ReactivityGraph } from '../live-queries/base-class.js'
import { NOT_REFRESHED_YET } from '../reactive.js'
import type { SynchronousDatabaseWrapper } from '../SynchronousDatabaseWrapper.js'
import { emptyDebugInfo as makeEmptyDebugInfo } from '../SynchronousDatabaseWrapper.js'
import type { ReferenceCountedSet } from '../utils/data-structures.js'

type IStore = {
  clientSession: ClientSession
  reactivityGraph: ReactivityGraph
  syncDbWrapper: SynchronousDatabaseWrapper
  activeQueries: ReferenceCountedSet<LiveQuery<any>>
}

type Unsub = () => void
type RequestId = string
type SubMap = Map<RequestId, Unsub>

export const connectDevtoolsToStore = ({
  storeDevtoolsChannel,
  store,
}: {
  storeDevtoolsChannel: WebChannel.WebChannel<Devtools.MessageToAppHostStore, Devtools.MessageFromAppHostStore>
  store: IStore
}) =>
  Effect.gen(function* () {
    const appHostId = store.clientSession.coordinator.devtools.appHostId

    const reactivityGraphSubcriptions: SubMap = new Map()
    const liveQueriesSubscriptions: SubMap = new Map()
    const debugInfoHistorySubscriptions: SubMap = new Map()

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        reactivityGraphSubcriptions.forEach((unsub) => unsub())
        liveQueriesSubscriptions.forEach((unsub) => unsub())
        debugInfoHistorySubscriptions.forEach((unsub) => unsub())
      }),
    )

    const sendToDevtools = (message: Devtools.MessageFromAppHostStore) =>
      storeDevtoolsChannel.send(message).pipe(Effect.tapCauseLogPretty, Effect.runSync)

    const onMessage = (decodedMessage: typeof Devtools.MessageToAppHostStore.Type) => {
      // console.log('storeMessagePort message', decodedMessage)

      if (decodedMessage.appHostId !== store.clientSession.coordinator.devtools.appHostId) {
        // console.log(`Unknown message`, event)
        return
      }

      const requestId = decodedMessage.requestId

      const requestIdleCallback = globalThis.requestIdleCallback ?? ((cb: () => void) => cb())

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
                    appHostId,
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
              debugInfo: store.syncDbWrapper.debugInfo,
              requestId,
              appHostId,
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
            buffer.push(store.syncDbWrapper.debugInfo)

            // NOTE this resets the debug info, so all other "readers" e.g. in other `requestAnimationFrame` loops,
            // will get the empty debug info
            // TODO We need to come up with a more graceful way to do store. Probably via a single global
            // `requestAnimationFrame` loop that is passed in somehow.
            store.syncDbWrapper.debugInfo = makeEmptyDebugInfo()

            if (buffer.length > 10) {
              sendToDevtools(
                Devtools.DebugInfoHistoryRes.make({
                  debugInfoHistory: buffer,
                  requestId,
                  appHostId,
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
          store.syncDbWrapper.debugInfo.slowQueries.clear()
          sendToDevtools(Devtools.DebugInfoResetRes.make({ requestId, appHostId, liveStoreVersion }))
          break
        }
        case 'LSD.DebugInfoRerunQueryReq': {
          const { queryStr, bindValues, queriedTables } = decodedMessage
          store.syncDbWrapper.select(queryStr, { bindValues, queriedTables, skipCache: true })
          sendToDevtools(Devtools.DebugInfoRerunQueryRes.make({ requestId, appHostId, liveStoreVersion }))
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
                    appHostId,
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

    yield* storeDevtoolsChannel.listen.pipe(
      Stream.flatten(),
      Stream.tapSync((message) => onMessage(message)),
      Stream.runDrain,
      Effect.withSpan('LSD.devtools.onMessage'),
    )
  }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('LSD.devtools.connectStoreToDevtools'))
