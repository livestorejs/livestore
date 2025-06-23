import { LS_DEV, shouldNeverHappen } from '@livestore/utils'
import { Effect, Option, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import * as EventSequenceNumber from '../schema/EventSequenceNumber.js'
import * as LiveStoreEvent from '../schema/LiveStoreEvent.js'
import {
  EVENTLOG_META_TABLE,
  eventlogMetaTable,
  eventlogSystemTables,
  sessionChangesetMetaTable,
  SYNC_STATUS_TABLE,
} from '../schema/state/sqlite/system-tables.js'
import { migrateTable } from '../schema-management/migrations.js'
import { insertRow, updateRows } from '../sql-queries/sql-queries.js'
import type { PreparedBindValues } from '../util.js'
import { sql } from '../util.js'
import { execSql } from './connection.js'
import type { InitialSyncInfo } from './types.js'
import { LeaderThreadCtx } from './types.js'

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

/** Exclusive of the "since event" */
export const getEventsSince = ({
  dbEventlog,
  dbState,
  since,
}: {
  dbEventlog: SqliteDb
  dbState: SqliteDb
  since: EventSequenceNumber.EventSequenceNumber
}): Effect.Effect<ReadonlyArray<LiveStoreEvent.EncodedWithMeta>> =>
  Effect.gen(function* () {
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
          seqNum: { global: eventlogEvent.seqNumGlobal, client: eventlogEvent.seqNumClient },
          parentSeqNum: { global: eventlogEvent.parentSeqNumGlobal, client: eventlogEvent.parentSeqNumClient },
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
  })

export const getClientHeadFromDb = (dbEventlog: SqliteDb): EventSequenceNumber.EventSequenceNumber => {
  const res = dbEventlog.select<{
    seqNumGlobal: EventSequenceNumber.GlobalEventSequenceNumber
    seqNumClient: EventSequenceNumber.ClientEventSequenceNumber
  }>(
    sql`select seqNumGlobal, seqNumClient from ${EVENTLOG_META_TABLE} order by seqNumGlobal DESC, seqNumClient DESC limit 1`,
  )[0]

  return res ? { global: res.seqNumGlobal, client: res.seqNumClient } : EventSequenceNumber.ROOT
}

export const getBackendHeadFromDb = (dbEventlog: SqliteDb): EventSequenceNumber.GlobalEventSequenceNumber =>
  dbEventlog.select<{ head: EventSequenceNumber.GlobalEventSequenceNumber }>(
    sql`select head from ${SYNC_STATUS_TABLE}`,
  )[0]?.head ?? EventSequenceNumber.ROOT.global

// TODO use prepared statements
export const updateBackendHead = (dbEventlog: SqliteDb, head: EventSequenceNumber.EventSequenceNumber) =>
  dbEventlog.execute(sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${head.global}`)

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
          `Parent mutation ${eventEncoded.parentSeqNum.global},${eventEncoded.parentSeqNum.client} does not exist`,
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
          parentSeqNumGlobal: eventEncoded.parentSeqNum.global,
          parentSeqNumClient: eventEncoded.parentSeqNum.client,
          name: eventEncoded.name,
          argsJson: eventEncoded.args ?? {},
          clientId,
          sessionId,
          schemaHash: eventDefSchemaHash,
          syncMetadataJson: eventEncoded.meta.syncMetadata,
        },
      }),
    )
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

export const getSyncBackendCursorInfo = (remoteHead: EventSequenceNumber.GlobalEventSequenceNumber) =>
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
      cursor: { global: remoteHead, client: EventSequenceNumber.clientDefault },
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  }).pipe(Effect.withSpan('@livestore/common:eventlog:getSyncBackendCursorInfo', { attributes: { remoteHead } }))
