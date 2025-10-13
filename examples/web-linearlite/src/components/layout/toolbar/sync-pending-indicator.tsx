import { useStore } from '@livestore/react'
import { Effect, Stream } from '@livestore/utils/effect'
import React from 'react'

// Small spinner shown when either client session or leader has pending sync changes
export const SyncPendingIndicator = () => {
  const { store } = useStore()
  const [isPending, setIsPending] = React.useState(false)

  React.useEffect(
    () =>
      Effect.gen(function* () {
        const compute = Effect.gen(function* () {
          const session = yield* store.syncProcessor.syncState
          const leader = yield* store.clientSession.leaderThread.getSyncState
          const sessionHasPending = session.pending.length > 0
          const leaderHasPendingGlobalOnly = leader.pending.some((e) => e.seqNum.client === 0)
          const hasPending = sessionHasPending || leaderHasPendingGlobalOnly
          yield* Effect.sync(() => setIsPending(hasPending))
        })

        // Initial compute
        yield* compute

        // Recompute on session sync updates and on leader connectivity changes
        const ticks = Stream.merge(
          store.syncProcessor.syncState.changes.pipe(Stream.map(() => null)),
          store.networkStatus.changes.pipe(Stream.map(() => null)),
        )
        yield* ticks.pipe(
          Stream.runForEach(() => compute),
          Effect.scoped,
        )
      }).pipe(Effect.runCallback),
    [store],
  )

  return (
    <div className="ml-1 mr-1 flex items-center" title={isPending ? 'Syncing…' : undefined}>
      <div
        className={`h-3 w-3 rounded-full border-2 ${
          isPending ? 'border-neutral-400 border-t-transparent animate-spin' : 'border-transparent'
        }`}
      />
    </div>
  )
}
