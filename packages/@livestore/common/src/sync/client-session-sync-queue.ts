import type { Scope } from '@livestore/utils/effect'
import { Effect, Schema, Stream } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { Coordinator, EventId, UnexpectedError } from '../adapter-types.js'
import { type LiveStoreSchema, makeMutationEventSchemaMemo } from '../schema/index.js'
import type { MutationEvent } from '../schema/mutations.js'
import { makeNextMutationEventIdPair } from './next-mutation-event-id-pair.js'
import type { SyncState } from './syncstate.js'
import { MutationEventEncodedWithDeferred, nextEventIdPair, updateSyncState } from './syncstate.js'

const isEqualEvent = (a: MutationEvent.AnyEncoded, b: MutationEvent.AnyEncoded) =>
  a.id.global === b.id.global &&
  a.id.local === b.id.local &&
  a.mutation === b.mutation &&
  // TODO use schema equality here
  JSON.stringify(a.args) === JSON.stringify(b.args)

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
  // const localHeadRef = { current: initialLeaderHead }
  // const leaderHeadRef = { current: initialLeaderHead }
  // const backendHeadRef = { current: initialBackendHead }

  type LocalItem = {
    // mutationEvent: MutationEvent.AnyEncoded
    sessionChangeset: Uint8Array
  }

  const mutationEventSchema = makeMutationEventSchemaMemo(schema)

  // TODO init from leader
  /** Keeps track of events which haven't been synced all the way to the backend yet */
  const changesetItems: LocalItem[] = []

  // const nextMutationEventIdPair = makeNextMutationEventIdPair(localHeadRef)

  const syncStateRef = {
    current: {
      localHead: initialLeaderHead,
      upstreamHead: initialLeaderHead,
      pending: [],
      rollbackTail: [],
    } as SyncState,
  }

  const isLocalEvent = (mutationEventEncoded: MutationEventEncodedWithDeferred) => {
    const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
    return mutationDef.options.localOnly
  }

  const push: ClientSessionSyncQueue['push'] = (batch, { otelContext }) => {
    // TODO validate batch

    const encodedMutationEvents = batch.map((mutationEvent) => {
      const mutationDef = schema.mutations.get(mutationEvent.mutation)!
      return new MutationEventEncodedWithDeferred(
        Schema.encodeUnknownSync(mutationEventSchema)({
          ...mutationEvent,
          ...nextEventIdPair(syncStateRef.current.localHead, mutationDef.options.localOnly),
          // ...nextMutationEventIdPair({ localOnly: mutationDef.options.localOnly }),
        }),
      )
    })

    const res = updateSyncState({
      syncState: syncStateRef.current,
      payload: { _tag: 'local-push', newEvents: encodedMutationEvents },
      isLocalEvent,
      isEqualEvent,
    })

    syncStateRef.current = res.syncState

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

    changesetItems.push(...sessionChangesets.map((sessionChangeset) => ({ sessionChangeset })))

    // TODO properly run effect in parent runtime
    pushToLeader(encodedMutationEvents, { persisted: true }).pipe(Effect.tapCauseLogPretty, Effect.runFork)

    return { writeTables }
  }

  const boot: ClientSessionSyncQueue['boot'] = Effect.gen(function* () {
    yield* pullFromLeader.pipe(
      Stream.tap(({ payload, remaining }) =>
        Effect.gen(function* () {
          // console.log('pulled: mutationEvents', { mutationEvents, localItems: changesetItems, backendHead })

          // backendHeadRef.current = backendHead

          const res = updateSyncState({
            syncState: syncStateRef.current,
            payload,
            isLocalEvent,
            isEqualEvent,
          })

          syncStateRef.current = res.syncState

          // const filteredChunk: MutationEvent.AnyEncoded[] = []

          if (res._tag === 'reject') {
            throw new Error('TODO: implement reject in client-session-sync-queue for pull')
          }

          if (res._tag === 'rebase') {
            throw new Error('TODO: implement rebase in client-session-sync-queue for pull')
          }

          const mutationEvents = res.newEvents

          console.log('pulled: mutationEvents', { mutationEvents })

          if (mutationEvents.length === 0) return

          // TODO
          const needsChangeset = true

          const writeTables = new Set<string>()
          for (const mutationEvent of mutationEvents) {
            // TODO pass otelContext
            const res = applyMutation(mutationEvent, { otelContext: undefined, withChangeset: needsChangeset })
            for (const table of res.writeTables) {
              writeTables.add(table)
            }
          }

          // TODO add to localItems if `needsChangeset` is true

          refreshTables(writeTables)

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
