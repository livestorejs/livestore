import type { Scope } from '@livestore/utils/effect'
import { Effect, Schema, Stream } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { Coordinator, EventId, UnexpectedError } from '../adapter-types.js'
import { type LiveStoreSchema, makeMutationEventSchemaMemo } from '../schema/index.js'
import type { MutationEvent } from '../schema/mutations.js'
import { makeNextMutationEventIdPair } from './next-mutation-event-id-pair.js'

/**
 * Rebase behaviour:
 * - We continously pull mutations from the leader and apply them to the local store.
 * - If there was a race condition (i.e. the leader and client session have both advacned),
 *   we'll need to rebase the local pending mutations on top of the leader's head.
 * - The goal is to never block the UI, so we'll interrupt rebasing if a new mutations is pushed by the client session.
 * - We also want to avoid "backwards-jumping" in the UI, so we'll transactionally apply a read model changes during a rebase.
 * - We might need to make the rebase behaviour configurable e.g. to let users manually trigger a rebase
 */
export const makeClientSessionSyncQueue = ({
  schema,
  initialLeaderHead,
  initialBackendHead,
  pushToLeader,
  pullFromLeader,
  applyMutation,
  refreshTables,
}: {
  schema: LiveStoreSchema
  initialLeaderHead: EventId
  initialBackendHead: number
  pushToLeader: Coordinator['mutations']['push']
  pullFromLeader: Coordinator['mutations']['pull']
  applyMutation: (
    mutationEventDecoded: MutationEvent.PartialAny,
    options: { otelContext: otel.Context | undefined; withChangeset: boolean },
  ) => {
    writeTables: Set<string>
    sessionChangeset: Uint8Array | undefined
  }
  refreshTables: (tables: Set<string>) => void
  rebaseBehaviour: 'auto-rebase' | 'manual-rebase'
}): ClientSessionSyncQueue => {
  const localHeadRef = { current: initialLeaderHead }
  const leaderHeadRef = { current: initialLeaderHead }
  const backendHeadRef = { current: initialBackendHead }

  type LocalItem = {
    mutationEvent: MutationEvent.AnyEncoded
    sessionChangeset: Uint8Array
  }

  const mutationEventSchema = makeMutationEventSchemaMemo(schema)

  // TODO init from leader
  /** Keeps track of events which haven't been synced all the way to the backend yet */
  const localItems: LocalItem[] = []

  const nextMutationEventIdPair = makeNextMutationEventIdPair(localHeadRef)

  const push: ClientSessionSyncQueue['push'] = (batch, { otelContext }) => {
    // TODO validate batch

    // TODO
    const writeTables = new Set<string>()
    const sessionChangesets: Uint8Array[] = []
    for (const mutationEvent of batch) {
      const res = applyMutation(mutationEvent, { otelContext, withChangeset: true })
      for (const table of res.writeTables) {
        writeTables.add(table)
      }
      sessionChangesets.push(res.sessionChangeset!)
    }

    const encodedMutationEvents = batch.map((mutationEvent) => {
      const mutationDef = schema.mutations.get(mutationEvent.mutation)!
      return Schema.encodeUnknownSync(mutationEventSchema)({
        ...mutationEvent,
        ...nextMutationEventIdPair({ localOnly: mutationDef.options.localOnly }),
      })
    })

    localItems.push(
      ...encodedMutationEvents.map((mutationEvent, i) => ({
        mutationEvent,
        sessionChangeset: sessionChangesets[i]!,
      })),
    )

    // TODO properly run effect in parent runtime
    pushToLeader(encodedMutationEvents, { persisted: true }).pipe(Effect.tapCauseLogPretty, Effect.runFork)

    return { writeTables }
  }

  const boot: ClientSessionSyncQueue['boot'] = Effect.gen(function* () {
    yield* pullFromLeader.pipe(
      Stream.tap(({ mutationEvents, backendHead }) =>
        Effect.gen(function* () {
          console.log('pulled: mutationEvents', { mutationEvents, localItems, backendHead })

          backendHeadRef.current = backendHead

          const filteredChunk: MutationEvent.AnyEncoded[] = []

          for (let i = 0; i < mutationEvents.length; i++) {
            const localItem = localItems[i]
            const pullItem = mutationEvents[i]!
            if (localItem?.mutationEvent.id.global === pullItem.id.global) {
              localItems.splice(i, 1)
            } else {
              filteredChunk.push(pullItem)
            }
          }

          console.log('pulled: filteredChunk', { filteredChunk, localItems })

          if (filteredChunk.length === 0) return

          const lastEventId = filteredChunk.at(-1)!.id

          const needsChangeset = lastEventId.global >= backendHead

          const writeTables = new Set<string>()
          for (const mutationEvent of filteredChunk) {
            // TODO pass otelContext
            const res = applyMutation(mutationEvent, { otelContext: undefined, withChangeset: needsChangeset })
            for (const table of res.writeTables) {
              writeTables.add(table)
            }
          }

          // TODO add to localItems if `needsChangeset` is true

          refreshTables(writeTables)

          leaderHeadRef.current = lastEventId

          if (localHeadRef.current.global < leaderHeadRef.current.global) {
            console.log('setting new local head', { ...leaderHeadRef.current })
            localHeadRef.current = leaderHeadRef.current
          }

          // TODO
        }),
      ),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )
  })

  return {
    // push,
    push,
    boot,
  } satisfies ClientSessionSyncQueue
}

export interface ClientSessionSyncQueue {
  // push: (batch: SyncQueueItem[]) => Effect.Effect<void, UnexpectedError>
  push: (
    batch: ReadonlyArray<MutationEvent.PartialAny>,
    options: { otelContext: otel.Context },
  ) => {
    writeTables: Set<string>
  }
  boot: Effect.Effect<void, UnexpectedError, Scope.Scope>
}
