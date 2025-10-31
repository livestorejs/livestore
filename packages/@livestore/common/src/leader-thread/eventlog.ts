import { LS_DEV, shouldNeverHappen } from '@livestore/utils'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'
import type { SqliteDb } from '../adapter-types.ts'
import type { UnexpectedError } from '../errors.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent.ts'
import {
  EVENTLOG_META_TABLE,
  eventlogMetaTable,
  eventlogSystemTables,
  SYNC_STATUS_TABLE,
} from '../schema/state/sqlite/system-tables/eventlog-tables.ts'
import { sessionChangesetMetaTable } from '../schema/state/sqlite/system-tables/state-tables.ts'
import { migrateTable } from '../schema-management/migrations.ts'
import { insertRow, updateRows } from '../sql-queries/sql-queries.ts'
import type { PreparedBindValues } from '../util.ts'
import { sql } from '../util.ts'
import { execSql } from './connection.ts'
import type { InitialSyncInfo } from './types.ts'
import { LeaderThreadCtx } from './types.ts'

export const initEventlogDb = (dbEventlog: SqliteDb) =>
  Effect.gen(function* () {
    for (const tableDef of eventlogSystemTables) {
      yield* migrateTable({
        db: dbEventlog,
        behaviour: 'create-if-not-exists',
        tableAst: tableDef.sqliteDef.ast,
        skipMetaTable: true,
      })
    }

    // Create sync status row if it doesn't exist
    yield* execSql(
      dbEventlog,
      sql`INSERT INTO ${SYNC_STATUS_TABLE} (head)
          SELECT ${EventSequenceNumber.ROOT.global}
          WHERE NOT EXISTS (SELECT 1 FROM ${SYNC_STATUS_TABLE})`,
      {},
    )
  })

/**
 * Exclusive of the "since event"
 * Also queries the state db in order to get the SQLite session changeset data.
 */
export const getEventsSince = ({
  dbEventlog,
  dbState,
  since,
}: {
  dbEventlog: SqliteDb
  dbState: SqliteDb
  since: EventSequenceNumber.EventSequenceNumber
}): ReadonlyArray<LiveStoreEvent.EncodedWithMeta> => {
  const pendingEvents = dbEventlog.select(eventlogMetaTable.where('seqNumGlobal', '>=', since.global))

  const sessionChangesetRowsDecoded = dbState.select(
    sessionChangesetMetaTable.where('seqNumGlobal', '>=', since.global),
  )

  return pendingEvents
    .map((eventlogEvent) => {
      const sessionChangeset = sessionChangesetRowsDecoded.find(
        (readModelEvent) =>
          readModelEvent.seqNumGlobal === eventlogEvent.seqNumGlobal &&
          readModelEvent.seqNumClient === eventlogEvent.seqNumClient,
      )
      return LiveStoreEvent.EncodedWithMeta.make({
        name: eventlogEvent.name,
        args: eventlogEvent.argsJson,
        seqNum: {
          global: eventlogEvent.seqNumGlobal,
          client: eventlogEvent.seqNumClient,
          rebaseGeneration: eventlogEvent.seqNumRebaseGeneration,
        },
        parentSeqNum: {
          global: eventlogEvent.parentSeqNumGlobal,
          client: eventlogEvent.parentSeqNumClient,
          rebaseGeneration: eventlogEvent.parentSeqNumRebaseGeneration,
        },
        clientId: eventlogEvent.clientId,
        sessionId: eventlogEvent.sessionId,
        meta: {
          sessionChangeset:
            sessionChangeset && sessionChangeset.changeset !== null
              ? {
                  _tag: 'sessionChangeset' as const,
                  data: sessionChangeset.changeset,
                  debug: sessionChangeset.debug,
                }
              : { _tag: 'unset' as const },
          syncMetadata: eventlogEvent.syncMetadataJson,
          materializerHashLeader: Option.none(),
          materializerHashSession: Option.none(),
        },
      })
    })
    .filter((_) => EventSequenceNumber.compare(_.seqNum, since) > 0)
    .sort((a, b) => EventSequenceNumber.compare(a.seqNum, b.seqNum))
}

/**
 * Stream events from the eventlog with advanced filtering options
 */
export const streamEventsFromEventlog = ({
  dbEventlog,
  dbState,
  options,
}: {
  dbEventlog: SqliteDb
  dbState: SqliteDb
  options: {
    since: EventSequenceNumber.EventSequenceNumber
    until?: EventSequenceNumber.EventSequenceNumber
    filter?: ReadonlyArray<string>
    clientIds?: ReadonlyArray<string>
    sessionIds?: ReadonlyArray<string>
    batchSize?: number
  }
}): Stream.Stream<LiveStoreEvent.EncodedWithMeta, UnexpectedError> => {
  const batchSize = options.batchSize ?? 1000

  const makeQuery = (offset: number) => {
    let query = eventlogMetaTable.where('seqNumGlobal', '>', options.since.global)

    if (options.until) {
      query = query.where('seqNumGlobal', '<=', options.until.global)
    }

    if (options.filter && options.filter.length > 0) {
      query = query.where({ name: { op: 'IN', value: options.filter } })
    }

    if (options.clientIds && options.clientIds.length > 0) {
      query = query.where({ clientId: { op: 'IN', value: options.clientIds } })
    }

    if (options.sessionIds && options.sessionIds.length > 0) {
      query = query.where({ sessionId: { op: 'IN', value: options.sessionIds } })
    }

    return query
      .orderBy([
        { col: 'seqNumGlobal', direction: 'asc' },
        { col: 'seqNumClient', direction: 'asc' },
      ])
      .offset(offset)
      .limit(batchSize)
  }

  return Stream.unfold(0, (offset) => {
    const eventlogEvents = dbEventlog.select(makeQuery(offset))

    if (eventlogEvents.length === 0) {
      return Option.none()
    }

    // Get session changeset data for this batch
    const minSeqNum = Math.min(
      ...eventlogEvents.map((e) => e.seqNumGlobal),
    ) as EventSequenceNumber.GlobalEventSequenceNumber
    const maxSeqNum = Math.max(
      ...eventlogEvents.map((e) => e.seqNumGlobal),
    ) as EventSequenceNumber.GlobalEventSequenceNumber

    const sessionChangesetRowsDecoded = dbState.select(
      sessionChangesetMetaTable.where('seqNumGlobal', '>=', minSeqNum).where('seqNumGlobal', '<=', maxSeqNum),
    )

    // Convert to EncodedWithMeta and emit
    const encodedEvents = eventlogEvents.map((eventlogEvent) => {
      const sessionChangeset = sessionChangesetRowsDecoded.find(
        (readModelEvent) =>
          readModelEvent.seqNumGlobal === eventlogEvent.seqNumGlobal &&
          readModelEvent.seqNumClient === eventlogEvent.seqNumClient,
      )

      return LiveStoreEvent.EncodedWithMeta.make({
        name: eventlogEvent.name,
        args: eventlogEvent.argsJson,
        seqNum: {
          global: eventlogEvent.seqNumGlobal,
          client: eventlogEvent.seqNumClient,
          rebaseGeneration: eventlogEvent.seqNumRebaseGeneration,
        },
        parentSeqNum: {
          global: eventlogEvent.parentSeqNumGlobal,
          client: eventlogEvent.parentSeqNumClient,
          rebaseGeneration: eventlogEvent.parentSeqNumRebaseGeneration,
        },
        clientId: eventlogEvent.clientId,
        sessionId: eventlogEvent.sessionId,
        meta: {
          sessionChangeset:
            sessionChangeset && sessionChangeset.changeset !== null
              ? {
                  _tag: 'sessionChangeset' as const,
                  data: sessionChangeset.changeset,
                  debug: sessionChangeset.debug,
                }
              : { _tag: 'unset' as const },
          syncMetadata: eventlogEvent.syncMetadataJson,
          materializerHashLeader: Option.none(),
          materializerHashSession: Option.none(),
        },
      })
    })

    const nextOffset = offset + batchSize

    return Option.some([Chunk.fromIterable(encodedEvents), nextOffset] as const)
  }).pipe(
    Stream.flattenChunks,
    Stream.tapError((error) => Effect.logError('Error streaming events from eventlog', error)),
  )
}

export const getClientHeadFromDb = (dbEventlog: SqliteDb): EventSequenceNumber.EventSequenceNumber => {
  const res = dbEventlog.select<{
    seqNumGlobal: EventSequenceNumber.GlobalEventSequenceNumber
    seqNumClient: EventSequenceNumber.ClientEventSequenceNumber
    seqNumRebaseGeneration: number
  }>(
    sql`select seqNumGlobal, seqNumClient, seqNumRebaseGeneration from ${EVENTLOG_META_TABLE} order by seqNumGlobal DESC, seqNumClient DESC limit 1`,
  )[0]

  return res
    ? { global: res.seqNumGlobal, client: res.seqNumClient, rebaseGeneration: res.seqNumRebaseGeneration }
    : EventSequenceNumber.ROOT
}

export const getBackendHeadFromDb = (dbEventlog: SqliteDb): EventSequenceNumber.GlobalEventSequenceNumber =>
  dbEventlog.select<{ head: EventSequenceNumber.GlobalEventSequenceNumber }>(
    sql`select head from ${SYNC_STATUS_TABLE}`,
  )[0]?.head ?? EventSequenceNumber.ROOT.global

// TODO use prepared statements
export const updateBackendHead = (dbEventlog: SqliteDb, head: EventSequenceNumber.EventSequenceNumber) =>
  dbEventlog.execute(sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${head.global}`)

export const getBackendIdFromDb = (dbEventlog: SqliteDb): Option.Option<string> =>
  Option.fromNullable(
    dbEventlog.select<{ backendId: string | null }>(sql`select backendId from ${SYNC_STATUS_TABLE}`)[0]?.backendId,
  )

export const updateBackendId = (dbEventlog: SqliteDb, backendId: string) =>
  dbEventlog.execute(sql`UPDATE ${SYNC_STATUS_TABLE} SET backendId = '${backendId}'`)

export const insertIntoEventlog = (
  eventEncoded: LiveStoreEvent.EncodedWithMeta,
  dbEventlog: SqliteDb,
  eventDefSchemaHash: number,
  clientId: string,
  sessionId: string,
) =>
  Effect.gen(function* () {
    // Check history consistency during LS_DEV
    if (LS_DEV && eventEncoded.parentSeqNum.global !== EventSequenceNumber.ROOT.global) {
      const parentEventExists =
        dbEventlog.select<{ count: number }>(
          `SELECT COUNT(*) as count FROM ${EVENTLOG_META_TABLE} WHERE seqNumGlobal = ? AND seqNumClient = ?`,
          [eventEncoded.parentSeqNum.global, eventEncoded.parentSeqNum.client] as any as PreparedBindValues,
        )[0]!.count === 1

      if (parentEventExists === false) {
        shouldNeverHappen(
          `Parent event ${eventEncoded.parentSeqNum.global},${eventEncoded.parentSeqNum.client} does not exist in eventlog`,
        )
      }
    }

    // TODO use prepared statements
    yield* execSql(
      dbEventlog,
      ...insertRow({
        tableName: EVENTLOG_META_TABLE,
        columns: eventlogMetaTable.sqliteDef.columns,
        values: {
          seqNumGlobal: eventEncoded.seqNum.global,
          seqNumClient: eventEncoded.seqNum.client,
          seqNumRebaseGeneration: eventEncoded.seqNum.rebaseGeneration,
          parentSeqNumGlobal: eventEncoded.parentSeqNum.global,
          parentSeqNumClient: eventEncoded.parentSeqNum.client,
          parentSeqNumRebaseGeneration: eventEncoded.parentSeqNum.rebaseGeneration,
          name: eventEncoded.name,
          argsJson: eventEncoded.args ?? {},
          clientId,
          sessionId,
          schemaHash: eventDefSchemaHash,
          syncMetadataJson: eventEncoded.meta.syncMetadata,
        },
      }),
    )

    dbEventlog.debug.head = eventEncoded.seqNum
  })

export const updateSyncMetadata = (items: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>) =>
  Effect.gen(function* () {
    const { dbEventlog } = yield* LeaderThreadCtx

    // TODO try to do this in a single query
    for (let i = 0; i < items.length; i++) {
      const event = items[i]!

      yield* execSql(
        dbEventlog,
        ...updateRows({
          tableName: EVENTLOG_META_TABLE,
          columns: eventlogMetaTable.sqliteDef.columns,
          where: { seqNumGlobal: event.seqNum.global, seqNumClient: event.seqNum.client },
          updateValues: { syncMetadataJson: event.meta.syncMetadata },
        }),
      )
    }
  })

export const getSyncBackendCursorInfo = ({
  remoteHead,
}: {
  remoteHead: EventSequenceNumber.GlobalEventSequenceNumber
}) =>
  Effect.gen(function* () {
    const { dbEventlog } = yield* LeaderThreadCtx

    if (remoteHead === EventSequenceNumber.ROOT.global) return Option.none()

    const EventlogQuerySchema = Schema.Struct({
      syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
    }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.head)

    const syncMetadataOption = yield* Effect.sync(() =>
      dbEventlog.select<{ syncMetadataJson: string }>(
        sql`SELECT syncMetadataJson FROM ${EVENTLOG_META_TABLE} WHERE seqNumGlobal = ${remoteHead} ORDER BY seqNumClient ASC LIMIT 1`,
      ),
    ).pipe(Effect.andThen(Schema.decode(EventlogQuerySchema)), Effect.map(Option.flatten), Effect.orDie)

    return Option.some({
      eventSequenceNumber: remoteHead,
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  }).pipe(Effect.withSpan('@livestore/common:eventlog:getSyncBackendCursorInfo', { attributes: { remoteHead } }))
