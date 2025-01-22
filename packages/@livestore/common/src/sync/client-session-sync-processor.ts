import { shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Schema, Stream } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import type { Coordinator, UnexpectedError } from '../adapter-types.js'
import * as EventId from '../schema/EventId.js'
import { type LiveStoreSchema } from '../schema/mod.js'
import * as MutationEvent from '../schema/MutationEvent.js'
import type { SyncState } from './syncstate.js'
import { updateSyncState } from './syncstate.js'

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
export const makeClientSessionSyncProcessor = ({
  schema,
  initialLeaderHead,
  pushToLeader,
  pullFromLeader,
  applyMutation,
  rollback,
  refreshTables,
  span,
}: {
  schema: LiveStoreSchema
  initialLeaderHead: EventId.EventId
  pushToLeader: (batch: ReadonlyArray<MutationEvent.AnyEncoded>) => void
  pullFromLeader: Coordinator['mutations']['pull']
  applyMutation: (
    mutationEventDecoded: MutationEvent.PartialAny,
    options: { otelContext: otel.Context | undefined; withChangeset: boolean },
  ) => {
    writeTables: Set<string>
    sessionChangeset: Uint8Array | undefined
  }
  rollback: (changeset: Uint8Array) => void
  refreshTables: (tables: Set<string>) => void
  // rebaseBehaviour: 'auto-rebase' | 'manual-rebase'
  span: otel.Span
}): ClientSessionSyncProcessor => {
  const mutationEventSchema = MutationEvent.makeMutationEventSchemaMemo(schema)

  const syncStateRef = {
    current: {
      localHead: initialLeaderHead,
      upstreamHead: initialLeaderHead,
      pending: [],
      // TODO init rollbackTail from leader to be ready for backend rebasing
      rollbackTail: [],
    } as SyncState,
  }

  const isLocalEvent = (mutationEventEncoded: MutationEvent.EncodedWithMeta) => {
    const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
    return mutationDef.options.localOnly
  }

  const push: ClientSessionSyncProcessor['push'] = (batch, { otelContext }) => {
    // TODO validate batch

    let baseEventId = syncStateRef.current.localHead
    const encodedMutationEvents = batch.map((mutationEvent) => {
      const mutationDef = schema.mutations.get(mutationEvent.mutation)!
      const nextIdPair = EventId.nextPair(baseEventId, mutationDef.options.localOnly)
      baseEventId = nextIdPair.id
      return new MutationEvent.EncodedWithMeta(
        Schema.encodeUnknownSync(mutationEventSchema)({ ...mutationEvent, ...nextIdPair }),
      )
    })

    const updateResult = updateSyncState({
      syncState: syncStateRef.current,
      payload: { _tag: 'local-push', newEvents: encodedMutationEvents },
      isLocalEvent,
      isEqualEvent,
    })

    span.addEvent('local-push', {
      batchSize: encodedMutationEvents.length,
      updateResult: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
    })

    if (updateResult._tag !== 'advance') {
      return shouldNeverHappen(`Expected advance, got ${updateResult._tag}`)
    }

    syncStateRef.current = updateResult.syncState

    // TODO
    const writeTables = new Set<string>()
    for (const mutationEvent of updateResult.newEvents) {
      const res = applyMutation(mutationEvent, { otelContext, withChangeset: true })
      for (const table of res.writeTables) {
        writeTables.add(table)
      }
      mutationEvent.meta.sessionChangeset = res.sessionChangeset
    }

    pushToLeader(encodedMutationEvents)

    return { writeTables }
  }

  const otelContext = otel.trace.setSpan(otel.context.active(), span)

  const boot: ClientSessionSyncProcessor['boot'] = Effect.gen(function* () {
    yield* pullFromLeader.pipe(
      Stream.tap(({ payload, remaining }) =>
        Effect.gen(function* () {
          // console.log('pulled payload from leader', { payload, remaining })

          const updateResult = updateSyncState({
            syncState: syncStateRef.current,
            payload,
            isLocalEvent,
            isEqualEvent,
          })

          syncStateRef.current = updateResult.syncState

          if (updateResult._tag === 'reject') {
            debugger
            throw new Error('TODO: implement reject in client-session-sync-queue for pull')
          }

          if (updateResult._tag === 'rebase') {
            span.addEvent('pull:rebase', {
              payloadTag: payload._tag,
              payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
              newEventsCount: updateResult.newEvents.length,
              rollbackCount: updateResult.eventsToRollback.length,
              res: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
              remaining,
            })

            for (let i = updateResult.eventsToRollback.length - 1; i >= 0; i--) {
              const event = updateResult.eventsToRollback[i]!
              if (event.meta.sessionChangeset) {
                rollback(event.meta.sessionChangeset)
                event.meta.sessionChangeset = undefined
              }
            }
          } else {
            span.addEvent('pull:advance', {
              payloadTag: payload._tag,
              payload: TRACE_VERBOSE ? JSON.stringify(payload) : undefined,
              newEventsCount: updateResult.newEvents.length,
              res: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
              remaining,
            })
          }

          if (updateResult.newEvents.length === 0) return

          const writeTables = new Set<string>()
          for (const mutationEvent of updateResult.newEvents) {
            const decodedMutationEvent = Schema.decodeSync(mutationEventSchema)(mutationEvent)
            const res = applyMutation(decodedMutationEvent, { otelContext, withChangeset: true })
            for (const table of res.writeTables) {
              writeTables.add(table)
            }

            mutationEvent.meta.sessionChangeset = res.sessionChangeset
          }

          refreshTables(writeTables)
        }),
      ),
      Stream.runDrain,
      Effect.tapCauseLogPretty,
      Effect.forkScoped,
    )
  })

  return {
    push,
    boot,
    syncStateRef,
  } satisfies ClientSessionSyncProcessor
}

export interface ClientSessionSyncProcessor {
  push: (
    batch: ReadonlyArray<MutationEvent.PartialAny>,
    options: { otelContext: otel.Context },
  ) => {
    writeTables: Set<string>
  }
  boot: Effect.Effect<void, UnexpectedError, Scope.Scope>

  syncStateRef: { current: SyncState }
}
