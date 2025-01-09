import type { Scope } from '@livestore/utils/effect'
import { Effect, Stream } from '@livestore/utils/effect'

import type { Coordinator, EventId, UnexpectedError } from '../adapter-types.js'
import type { LiveStoreSchema } from '../schema/index.js'
import type { MutationEvent } from '../schema/mutations.js'
import { makeNextMutationEventIdPair } from './next-mutation-event-id-pair.js'

/**
 * Rebase behaviour:
 * - We continously pull mutations from the leader and apply them to the local store.
 * - If there was a race condition (i.e. the leader and client session have both advacned),
 *   we'll need to rebase the local pending mutations on top of the leader's head.
 * - The goal is to never block the UI, so we'll interrupt rebasing if a new mutations is pushed.
 * - We might need to make the rebase behaviour configurable e.g. to let users manually trigger a rebase
 */
export const makeClientSessionSyncQueue = ({
  schema,
  initialLeaderHead,
  pushToLeader,
  pullFromLeader,
}: {
  schema: LiveStoreSchema
  initialLeaderHead: EventId
  pushToLeader: Coordinator['mutations']['push']
  pullFromLeader: Coordinator['mutations']['pull']
}): Effect.Effect<ClientSessionSyncQueue, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    // const push: ClientSessionSyncQueue['push'] = (batch) => Effect.gen(function* () {})

    const localHeadRef = {
      current: initialLeaderHead,
    }

    const leaderHeadRef = {
      current: initialLeaderHead,
    }

    const localItems: MutationEvent.AnyEncoded[] = []

    const nextMutationEventIdPair = makeNextMutationEventIdPair(localHeadRef)

    yield* pullFromLeader.pipe(
      Stream.tap(({ mutationEvents }) =>
        Effect.gen(function* () {
          // TODO
        }),
      ),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )

    const push: ClientSessionSyncQueue['push'] = (partialMutationEvent) =>
      Effect.gen(function* () {
        const mutationDef = schema.mutations.get(partialMutationEvent.mutation)!
        const localOnly = mutationDef.options.localOnly

        const nextEventIdPair = nextMutationEventIdPair({ localOnly })

        yield* pushToLeader({ ...partialMutationEvent, ...nextEventIdPair }, { persisted: true })

        // TODO
      })

    return {
      // push,
      push,
    } satisfies ClientSessionSyncQueue
  })

export interface ClientSessionSyncQueue {
  // push: (batch: SyncQueueItem[]) => Effect.Effect<void, UnexpectedError>
  push: (mutationEvent: MutationEvent.PartialAnyEncoded) => Effect.Effect<void, UnexpectedError>
}
