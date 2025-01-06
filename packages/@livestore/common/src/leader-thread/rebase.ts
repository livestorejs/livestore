import { Effect, Option, Schema } from '@livestore/utils/effect'

import { type EventId, type SynchronousDatabase } from '../adapter-types.js'
import { type MutationEvent } from '../schema/index.js'
import { LeaderThreadCtx } from './types.js'

/**
 * NOTE rebasing can be deferred arbitrarily long - a client is in a non-connected state if it hasn't rebased yet
 *
 * TODO figure out how client session interacts with rebasing
 * Maybe use some kind of weblock to coordinate across threads?
 *
 * TODO ideally design/build this function in a way so it can also be used in client sessions (i.e. without a persisted mutation log)
 *
 * Concurrency notes:
 * - LiveStore can't process new mutations while rebasing is in progress
 * -
 */
export const rebasePushQueue = (newUpstreamEvents: MutationEvent.AnyEncoded[]) =>
  Effect.andThen(
    LeaderThreadCtx,
    (ctx) =>
      Effect.gen(function* () {
        const { syncPushQueue } = ctx
        // const { syncPushQueue } = yield* LeaderThreadCtx

        // yield* syncPushQueue.isOpen.close
        // TODO implement rebasing

        // Overall plan:
        // Step 1: Build rebased mutation log
        // Step 2: Rollback and apply rebased mutation log

        // Step 1:
        // const queueItems = yield* Queue.takeAll(syncPushQueue.queue)

        const headGlobalId = newUpstreamEvents.at(-1)!.id.global

        // TODO properly handle local-only events
        // const rebasedLocalEvents = [...queueItems].map((item, index) => ({
        //   ...item,
        //   id: { global: headGlobalId + index + 1, local: 0 } satisfies EventId,
        //   parentId: { global: headGlobalId + index, local: 0 } satisfies EventId,
        // }))

        // TODO use proper event rebasing (with facts, rebaseFn etc)
        // const rebasedItems = [...newUpstreamEvents, ...rebasedLocalEvents]

        // Rollback mutations

        // Also update mutation log db rows

        // yield* syncPushQueue.isOpen.open
      }),
    // .pipe(ctx.syncPushQueue.semaphore.withPermits(1)),
  )
// .pipe(syncPushQueueSemaphore.withPermits(1))

// TODO use a push queue abstraction that's automatically persisted or allows for an in-memory implementation

export interface PushQueueClientSession {
  syncDb: SynchronousDatabase
  mode: 'client-session'

  // TODO maybe use a TRef
  items: PushQueueItemClientSession[]

  onNewPullChunk: (chunk: MutationEvent.AnyEncoded[]) => Effect.Effect<void, never, LeaderThreadCtx>
}

export interface PushQueueItemClientSession {
  mutationEventEncoded: MutationEvent.AnyEncoded
  syncStatus: 'accepted-by-leader' | 'confirmed' | 'pending'
}

/*
Decision how event interact with push queue:
- if it's coming from sync backend, it's confirmed -> remove from queue
- if it's coming from client session, it's not confirmed -> add to queue

Question: should the push queue follow something else or should something else follow the push queue?

- Push queue needs to rebase for new pull events which don't match the local push queue state
  - Rebase triggers updates to the push queue state + read model state


Question: how should the client session deal with rebase results from the leader thread?
- Idea: 
- client session push queue needs to keep items around until confirmed by the sync backend

Question: Should the client session push queue even care about confirmation by the leader thread or is it only interested in the sync backend confirmation?
- answer: yes, it's relevant because we need to make sure each client session is consistent - especially when the client is offline
*/
