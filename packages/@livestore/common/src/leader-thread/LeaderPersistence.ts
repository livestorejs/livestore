import type { Schema } from '@livestore/utils/effect'
import { Context, Effect, Option } from '@livestore/utils/effect'

import { MaterializeError, SqliteError, type SqliteDb } from '../adapter-types.ts'
import * as EventlogSqliteDb from '../EventlogSqliteDb.ts'
import * as MaterializationJournal from '../MaterializationJournal.ts'
import { EventSequenceNumber, LiveStoreEvent } from '../schema/mod.ts'
import * as StateHead from '../StateHead.ts'
import * as StateSqliteDb from '../StateSqliteDb.ts'
import * as Eventlog from './eventlog.ts'
import type { MaterializeEvent } from './types.ts'

export const TypeId = '~@livestore/common/LeaderPersistence' as const
export type TypeId = typeof TypeId

export interface LocalPersistPlan {
  readonly events: ReadonlyArray<LiveStoreEvent.Client.Encoded>
}

export interface PulledEvent {
  readonly event: LiveStoreEvent.Client.Encoded
  readonly syncMetadata: Option.Option<Schema.Json>
}

export interface UpstreamPersistPlan {
  /** The events received in the backend chunk, including metadata used to confirm pending events. */
  readonly pulledEvents: ReadonlyArray<PulledEvent>
  /** The merged events to materialize, including any locally rebased pending suffix. */
  readonly events: ReadonlyArray<LiveStoreEvent.Client.Encoded>
  readonly rollbackEvents: ReadonlyArray<LiveStoreEvent.Client.Encoded>
  readonly confirmedEvents: ReadonlyArray<LiveStoreEvent.Client.Encoded>
  readonly backendHead: EventSequenceNumber.Client.Composite
}

export interface LocalPersistReceipt {
  readonly _tag: 'local-persist'
  readonly persistedEvents: ReadonlyArray<LiveStoreEvent.Client.Encoded>
  readonly materializerHashes: ReadonlyArray<LiveStoreEvent.Client.MaterializerHash>
  readonly stateHead: EventSequenceNumber.Client.Composite
}

export interface UpstreamPersistReceipt {
  readonly _tag: 'upstream-persist'
  readonly persistedEvents: ReadonlyArray<LiveStoreEvent.Client.Encoded>
  readonly materializerHashes: ReadonlyArray<LiveStoreEvent.Client.MaterializerHash>
  readonly rolledBackEventNums: ReadonlyArray<EventSequenceNumber.Client.Composite>
  readonly stateHead: EventSequenceNumber.Client.Composite
  readonly backendHead: EventSequenceNumber.Client.Composite
}

export type PersistError = MaterializeError | MaterializationJournal.MaterializationJournalError

export interface Service {
  readonly [TypeId]: TypeId
  readonly persistLocal: (plan: LocalPersistPlan) => Effect.Effect<LocalPersistReceipt, PersistError>
  readonly persistUpstream: (plan: UpstreamPersistPlan) => Effect.Effect<UpstreamPersistReceipt, PersistError>
}

/**
 * Durable SQLite boundary for leader-sync transitions: rollback, materialization, journal maintenance, eventlog writes
 * and head updates. Queues, retries, publication and acknowledgements stay in `LeaderSyncProcessor`, which publishes
 * only what a successful receipt reports.
 */
export class LeaderPersistence extends Context.Service<LeaderPersistence, Service>()(
  '@livestore/common/LeaderPersistence',
) {}

export const make = ({ materializeEvent }: { materializeEvent: MaterializeEvent }) =>
  Effect.gen(function* () {
    const dbState = yield* StateSqliteDb.StateSqliteDb
    const dbEventlog = yield* EventlogSqliteDb.EventlogSqliteDb
    const materializationJournal = yield* MaterializationJournal.MaterializationJournal
    const stateHead = yield* StateHead.StateHead

    const materializeEvents = (
      events: ReadonlyArray<LiveStoreEvent.Client.Encoded>,
      pulledEvents: ReadonlyArray<PulledEvent> = [],
    ) =>
      Effect.forEach(events, (event) =>
        Effect.gen(function* () {
          const syncMetadata =
            pulledEvents.find(({ event: pulledEvent }) =>
              EventSequenceNumber.Client.isEqual(event.seqNum, pulledEvent.seqNum),
            )?.syncMetadata ?? Option.none()
          const { hash } = yield* materializeEvent(event, { syncMetadata })
          return LiveStoreEvent.Client.MaterializerHash.make({ eventNum: event.seqNum, hash })
        }),
      )

    const persistLocal: Service['persistLocal'] = ({ events }) =>
      withCoordinatedTransactions(
        { dbState, dbEventlog },
        Effect.gen(function* () {
          const materializerHashes = yield* materializeEvents(events)
          const persistedStateHead = yield* stateHead.get.pipe(
            Effect.mapError((cause) => MaterializeError.make({ cause })),
          )

          return {
            _tag: 'local-persist' as const,
            persistedEvents: events,
            materializerHashes,
            stateHead: persistedStateHead,
          }
        }),
      ).pipe(
        Effect.withSpan('@livestore/common:LeaderPersistence:persistLocal', {
          attributes: { batchSize: events.length },
        }),
      )

    const persistUpstream: Service['persistUpstream'] = (plan) =>
      withCoordinatedTransactions(
        { dbState, dbEventlog },
        Effect.gen(function* () {
          const rollbackEventNums = plan.rollbackEvents.map((event) => event.seqNum)

          if (rollbackEventNums.length > 0) {
            // A rebase first restores the old materialized state, then removes the events that no longer belong
            // in the eventlog. The replacement events can then be applied from the restored head.
            const headAfterRollback = plan.rollbackEvents[0]!.parentSeqNum
            yield* materializationJournal.rollback(rollbackEventNums)
            yield* stateHead.set(headAfterRollback).pipe(Effect.mapError((cause) => MaterializeError.make({ cause })))
            yield* Eventlog.deleteEvents(dbEventlog, rollbackEventNums).pipe(
              Effect.mapError((cause) => MaterializeError.make({ cause })),
            )
          }

          const materializerHashes = yield* materializeEvents(plan.events, plan.pulledEvents)

          if (plan.confirmedEvents.length > 0) {
            // Confirmed local events are already materialized. We only add the metadata learned from the backend.
            const confirmedPulledEvents = plan.pulledEvents.filter(({ event }) =>
              plan.confirmedEvents.some((confirmedEvent) =>
                isSameSequencePosition(event.seqNum, confirmedEvent.seqNum),
              ),
            )
            yield* Eventlog.updateSyncMetadataForDb(dbEventlog, confirmedPulledEvents).pipe(
              Effect.mapError((cause) => MaterializeError.make({ cause })),
            )
          }

          // Once the backend has reached this head, journal entries before it are no longer needed for a future rebase.
          yield* materializationJournal.discardUpTo(plan.backendHead)

          // The backend head and the corresponding event inserts share this eventlog transaction.
          yield* updateBackendHead(dbEventlog, plan.backendHead)

          const persistedStateHead = yield* stateHead.get.pipe(
            Effect.mapError((cause) => MaterializeError.make({ cause })),
          )

          return {
            _tag: 'upstream-persist' as const,
            persistedEvents: plan.events,
            materializerHashes,
            rolledBackEventNums: rollbackEventNums,
            stateHead: persistedStateHead,
            backendHead: plan.backendHead,
          }
        }),
      ).pipe(
        Effect.withSpan('@livestore/common:LeaderPersistence:persistUpstream', {
          attributes: {
            batchSize: plan.events.length,
            rollbackCount: plan.rollbackEvents.length,
            confirmedCount: plan.confirmedEvents.length,
          },
        }),
      )

    return LeaderPersistence.of({ [TypeId]: TypeId, persistLocal, persistUpstream })
  })

/**
 * Parent linkage identifies a position in the event chain. Rebase generation describes the version of optimistic
 * history, which the backend does not preserve, so it is not part of position identity.
 */
export const isSameSequencePosition = (
  left: EventSequenceNumber.Client.Composite,
  right: EventSequenceNumber.Client.Composite,
) => left.global === right.global && left.client === right.client

const withCoordinatedTransactions = <A, E, R>(
  { dbState, dbEventlog }: { dbState: SqliteDb; dbEventlog: SqliteDb },
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | MaterializeError, R> => {
  // These flags let cleanup roll back whichever transaction was actually opened or left behind by a failed commit.
  let stateTransactionOpen = false
  let eventlogTransactionOpen = false

  const rollbackOpenTransactions = Effect.gen(function* () {
    if (eventlogTransactionOpen === true) {
      yield* executeTransactionStatement(dbEventlog, 'ROLLBACK').pipe(Effect.ignore)
      eventlogTransactionOpen = false
    }
    if (stateTransactionOpen === true) {
      yield* executeTransactionStatement(dbState, 'ROLLBACK').pipe(Effect.ignore)
      stateTransactionOpen = false
    }
  })

  return Effect.gen(function* () {
    yield* executeTransactionStatement(dbState, 'BEGIN TRANSACTION')
    stateTransactionOpen = true
    yield* executeTransactionStatement(dbEventlog, 'BEGIN TRANSACTION')
    eventlogTransactionOpen = true

    const result = yield* effect

    // SQLite cannot atomically commit independent databases. Commit state first so a failed state
    // commit never publishes an eventlog head that claims the state transition is durable.
    yield* executeTransactionStatement(dbState, 'COMMIT')
    stateTransactionOpen = false
    yield* executeTransactionStatement(dbEventlog, 'COMMIT')
    eventlogTransactionOpen = false

    return result
  }).pipe(
    Effect.ensuring(rollbackOpenTransactions),
    // Do not allow cancellation between the two commits and the cleanup that follows a failure.
    Effect.uninterruptible,
  )
}

const executeTransactionStatement = (db: SqliteDb, statement: 'BEGIN TRANSACTION' | 'COMMIT' | 'ROLLBACK') =>
  Effect.try({
    try: () => db.execute(statement),
    catch: (cause) =>
      MaterializeError.make({
        cause: new SqliteError({ cause, query: { sql: statement, bindValues: [] } }),
        note: `Leader sync transaction failed during ${statement}`,
      }),
  })

const updateBackendHead = (dbEventlog: SqliteDb, head: EventSequenceNumber.Client.Composite) =>
  Effect.try({
    try: () => Eventlog.updateBackendHead(dbEventlog, head),
    catch: (cause) =>
      MaterializeError.make({
        cause: new SqliteError({ cause }),
        note: 'Failed to persist the leader sync backend head',
      }),
  })
