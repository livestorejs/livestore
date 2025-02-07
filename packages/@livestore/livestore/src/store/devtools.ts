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
  storeDevtoolsChannel: WebChannel.WebChannel<Devtools.MessageToAppClientSession, Devtools.MessageFromAppClientSession>
  store: IStore
}) =>
  Effect.gen(function* () {
    const reactivityGraphSubcriptions: SubMap = new Map()
    const liveQueriesSubscriptions: SubMap = new Map()
    const debugInfoHistorySubscriptions: SubMap = new Map()

    const { clientId, sessionId } = store.clientSession

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        reactivityGraphSubcriptions.forEach((unsub) => unsub())
        liveQueriesSubscriptions.forEach((unsub) => unsub())
        debugInfoHistorySubscriptions.forEach((unsub) => unsub())
      }),
    )

    const sendToDevtools = (message: Devtools.MessageFromAppClientSession) =>
      storeDevtoolsChannel.send(message).pipe(Effect.tapCauseLogPretty, Effect.runFork)

    const onMessage = (decodedMessage: typeof Devtools.MessageToAppClientSession.Type) => {
      // console.debug('@livestore/livestore:store:devtools:onMessage', decodedMessage)

      if (decodedMessage.clientId !== clientId || decodedMessage.sessionId !== sessionId) {
        // console.log(`Unknown message`, event)
        return
      }

      if (decodedMessage._tag === 'LSD.Disconnect') {
        // console.error('TODO handle disconnect properly in store')
        return
      }

      const requestId = decodedMessage.requestId

      const requestIdleCallback = globalThis.requestIdleCallback ?? ((cb: () => void) => cb())

      switch (decodedMessage._tag) {
        case 'LSD.ClientSession.ReactivityGraphSubscribe': {
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
                    clientId,
                    sessionId,
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
        case 'LSD.ClientSession.DebugInfoReq': {
          sendToDevtools(
            Devtools.DebugInfoRes.make({
              debugInfo: store.syncDbWrapper.debugInfo,
              requestId,
              clientId,
              sessionId,
              liveStoreVersion,
            }),
          )
          break
        }
        case 'LSD.ClientSession.DebugInfoHistorySubscribe': {
          const buffer: DebugInfo[] = []
          let hasStopped = false
          let tickHandle: number | undefined

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
                  clientId,
                  sessionId,
                  liveStoreVersion,
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

          debugInfoHistorySubscriptions.set(requestId, unsub)

          break
        }
        case 'LSD.ClientSession.DebugInfoHistoryUnsubscribe': {
          // NOTE given WebMesh channels have persistent retry behaviour, it can happen that a previous
          // WebMesh channel will send a unsubscribe message for an old requestId. Thus the `?.()` handling.
          debugInfoHistorySubscriptions.get(requestId)?.()
          debugInfoHistorySubscriptions.delete(requestId)
          break
        }
        case 'LSD.ClientSession.DebugInfoResetReq': {
          store.syncDbWrapper.debugInfo.slowQueries.clear()
          sendToDevtools(Devtools.DebugInfoResetRes.make({ requestId, clientId, sessionId, liveStoreVersion }))
          break
        }
        case 'LSD.ClientSession.DebugInfoRerunQueryReq': {
          const { queryStr, bindValues, queriedTables } = decodedMessage
          store.syncDbWrapper.select(queryStr, bindValues, { queriedTables, skipCache: true })
          sendToDevtools(Devtools.DebugInfoRerunQueryRes.make({ requestId, clientId, sessionId, liveStoreVersion }))
          break
        }
        case 'LSD.ClientSession.ReactivityGraphUnsubscribe': {
          // NOTE given WebMesh channels have persistent retry behaviour, it can happen that a previous
          // WebMesh channel will send a unsubscribe message for an old requestId. Thus the `?.()` handling.
          reactivityGraphSubcriptions.get(requestId)?.()
          break
        }
        case 'LSD.ClientSession.LiveQueriesSubscribe': {
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
                    clientId,
                    sessionId,
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
        case 'LSD.ClientSession.LiveQueriesUnsubscribe': {
          // NOTE given WebMesh channels have persistent retry behaviour, it can happen that a previous
          // WebMesh channel will send a unsubscribe message for an old requestId. Thus the `?.()` handling.
          liveQueriesSubscriptions.get(requestId)?.()
          liveQueriesSubscriptions.delete(requestId)
          break
        }
        // No default
      }
    }

    yield* storeDevtoolsChannel.listen.pipe(
      // Stream.tapLogWithLabel('@livestore/livestore:store:devtools:onMessage'),
      Stream.flatten(),
      Stream.tapSync((message) => onMessage(message)),
      Stream.runDrain,
      Effect.withSpan('LSD.devtools.onMessage'),
    )
  }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('LSD.devtools.connectStoreToDevtools'))
