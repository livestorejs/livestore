import { StoreInternalsSymbol } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { Effect, Stream } from '@livestore/utils/effect'
import React from 'react'
import { Switch } from 'react-aria-components'

export const SyncToggle = ({ className }: { className?: string }) => {
  // TODO hook up actual sync/network state
  const [sync, setSync] = React.useState(false)
  const hasPendingSyncEvents = usePendingSyncEvents()
  const statusText = hasPendingSyncEvents ? 'Pending sync events' : 'No pending sync events'

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span
        role="application"
        aria-live="polite"
        aria-label={statusText}
        title={statusText}
        className="flex size-6 items-center justify-center"
      >
        <span
          aria-hidden="true"
          className={`size-3 rounded-full border-2 ${
            hasPendingSyncEvents
              ? 'animate-spin border-orange-500 border-t-transparent'
              : 'border-transparent opacity-0'
          }`}
        />
        <span className="sr-only">{statusText}</span>
      </span>
      {/* TODO add disabled tooltip for now */}
      <Switch
        aria-label="Toggle sync/network"
        isSelected={sync}
        onChange={setSync}
        isDisabled={true} // TODO enable when sync is implemented
        className="group flex h-6 items-center gap-2 bg-neutral-800 hover:bg-neutral-700 rounded pl-1 pr-1.5 focus:outline-none focus:bg-neutral-700 cursor-pointer"
      >
        <div className="h-4 p-px w-6 bg-neutral-600 rounded-full group-data-[selected]:bg-orange-500 transition-colors">
          <span className="block size-3.5 bg-white rounded-full group-data-[selected]:translate-x-2 transition-transform" />
        </div>
        <span>
          Sync<span className="hidden xl:inline">/Network</span>
        </span>
      </Switch>
    </div>
  )
}

const usePendingSyncEvents = () => {
  const { store } = useStore()
  const [hasPendingEvents, setHasPendingEvents] = React.useState(false)
  const sessionPendingRef = React.useRef(false)
  const leaderPendingRef = React.useRef(false)

  React.useEffect(
    () =>
      Effect.gen(function* () {
        const isActive = true
        const leaderSyncState = store[StoreInternalsSymbol].clientSession.leaderThread.syncState

        const applyState = () => {
          if (!isActive) return
          setHasPendingEvents((prev) => {
            const next = sessionPendingRef.current || leaderPendingRef.current
            return prev === next ? prev : next
          })
        }

        const setSessionPending = (pending: boolean) => {
          if (sessionPendingRef.current !== pending) {
            sessionPendingRef.current = pending
          }

          applyState()
        }

        const setLeaderPending = (pending: boolean) => {
          if (leaderPendingRef.current !== pending) {
            leaderPendingRef.current = pending
          }

          applyState()
        }

        sessionPendingRef.current = false
        leaderPendingRef.current = false

        applyState()

        const sessionState = yield* store[StoreInternalsSymbol].syncProcessor.syncState
        const leaderState = yield* leaderSyncState

        setSessionPending(sessionState.pending.length > 0)
        setLeaderPending(leaderState.pending.filter((_) => _.seqNum.client === 0).length > 0)

        yield* store[StoreInternalsSymbol].syncProcessor.syncState.changes.pipe(
          Stream.tap((sessionState) => Effect.sync(() => setSessionPending(sessionState.pending.length > 0))),
          Stream.runDrain,
          Effect.interruptible,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        yield* leaderSyncState.changes.pipe(
          Stream.tap((leaderState) =>
            Effect.sync(() => setLeaderPending(leaderState.pending.filter((_) => _.seqNum.client === 0).length > 0)),
          ),
          Stream.runDrain,
          Effect.interruptible,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        return yield* Effect.never
      }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runCallback),
    [store],
  )

  return hasPendingEvents
}
