import { LS_DEV, shouldNeverHappen } from '@livestore/utils'
import { Effect, Option, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import * as EventId from '../schema/EventId.js'
import * as LiveStoreEvent from '../schema/LiveStoreEvent.js'
import {
  EVENTLOG_META_TABLE,
  eventlogMetaTable,
  sessionChangesetMetaTable,
  SYNC_STATUS_TABLE,
  syncStatusTable,
} from '../schema/system-tables.js'
import { migrateTable } from '../schema-management/migrations.js'
import { insertRow, updateRows } from '../sql-queries/sql-queries.js'
import type { PreparedBindValues } from '../util.js'
import { prepareBindValues, sql } from '../util.js'
import { execSql } from './connection.js'
import type { InitialSyncInfo } from './types.js'
import { LeaderThreadCtx } from './types.js'

export const initEventlogDb = (dbEventlog: SqliteDb) =>
  Effect.gen(function* () {
    yield* migrateTable({
      db: dbEventlog,
      behaviour: 'create-if-not-exists',
      tableAst: eventlogMetaTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    yield* migrateTable({
      db: dbEventlog,
      behaviour: 'create-if-not-exists',
      tableAst: syncStatusTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    // Create sync status row if it doesn't exist
    yield* execSql(
      dbEventlog,
      sql`INSERT INTO ${SYNC_STATUS_TABLE} (head)
          SELECT ${EventId.ROOT.global}
          WHERE NOT EXISTS (SELECT 1 FROM ${SYNC_STATUS_TABLE})`,
      {},
    )
  })

/** Exclusive of the "since event" */
export const getEventsSince = (
  since: EventId.EventId,
): Effect.Effect<ReadonlyArray<LiveStoreEvent.EncodedWithMeta>, never, LeaderThreadCtx> =>
  Effect.gen(function* () {
    const { dbEventlog, dbReadModel } = yield* LeaderThreadCtx

    const query = eventlogMetaTable.where('idGlobal', '>=', since.global).asSql()
    const pendingEventsRaw = dbEventlog.select(query.query, prepareBindValues(query.bindValues, query.query))
    const pendingEvents = Schema.decodeUnknownSync(eventlogMetaTable.rowSchema.pipe(Schema.Array))(pendingEventsRaw)

    const sessionChangesetRows = sessionChangesetMetaTable.where('idGlobal', '>=', since.global).asSql()
    const sessionChangesetRowsRaw = dbReadModel.select(
      sessionChangesetRows.query,
      prepareBindValues(sessionChangesetRows.bindValues, sessionChangesetRows.query),
    )
    const sessionChangesetRowsDecoded = Schema.decodeUnknownSync(
      sessionChangesetMetaTable.rowSchema.pipe(Schema.Array),
    )(sessionChangesetRowsRaw)

    return pendingEvents
      .map((eventlogEvent) => {
        const sessionChangeset = sessionChangesetRowsDecoded.find(
          (readModelEvent) =>
            readModelEvent.idGlobal === eventlogEvent.idGlobal && readModelEvent.idClient === eventlogEvent.idClient,
        )
        return LiveStoreEvent.EncodedWithMeta.make({
          mutation: eventlogEvent.mutation,
          args: eventlogEvent.argsJson,
          id: { global: eventlogEvent.idGlobal, client: eventlogEvent.idClient },
          parentId: { global: eventlogEvent.parentIdGlobal, client: eventlogEvent.parentIdClient },
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
          },
        })
      })
      .filter((_) => EventId.compare(_.id, since) > 0)
      .sort((a, b) => EventId.compare(a.id, b.id))
  })

export const getClientHeadFromDb = (dbEventlog: SqliteDb): EventId.EventId => {
  const res = dbEventlog.select<{ idGlobal: EventId.GlobalEventId; idClient: EventId.ClientEventId }>(
    sql`select idGlobal, idClient from ${EVENTLOG_META_TABLE} order by idGlobal DESC, idClient DESC limit 1`,
  )[0]

  return res ? { global: res.idGlobal, client: res.idClient } : EventId.ROOT
}

export const getBackendHeadFromDb = (dbEventlog: SqliteDb): EventId.GlobalEventId =>
  dbEventlog.select<{ head: EventId.GlobalEventId }>(sql`select head from ${SYNC_STATUS_TABLE}`)[0]?.head ??
  EventId.ROOT.global

// TODO use prepared statements
export const updateBackendHead = (dbEventlog: SqliteDb, head: EventId.EventId) =>
  dbEventlog.execute(sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${head.global}`)

export const insertIntoEventlog = (
  mutationEventEncoded: LiveStoreEvent.EncodedWithMeta,
  dbEventlog: SqliteDb,
  mutationDefSchemaHash: number,
  clientId: string,
  sessionId: string,
) =>
  Effect.gen(function* () {
    // Check history consistency during LS_DEV
    if (LS_DEV && mutationEventEncoded.parentId.global !== EventId.ROOT.global) {
      const parentMutationExists =
        dbEventlog.select<{ count: number }>(
          `SELECT COUNT(*) as count FROM ${EVENTLOG_META_TABLE} WHERE idGlobal = ? AND idClient = ?`,
          [mutationEventEncoded.parentId.global, mutationEventEncoded.parentId.client] as any as PreparedBindValues,
        )[0]!.count === 1

      if (parentMutationExists === false) {
        shouldNeverHappen(
          `Parent mutation ${mutationEventEncoded.parentId.global},${mutationEventEncoded.parentId.client} does not exist`,
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
          idGlobal: mutationEventEncoded.id.global,
          idClient: mutationEventEncoded.id.client,
          parentIdGlobal: mutationEventEncoded.parentId.global,
          parentIdClient: mutationEventEncoded.parentId.client,
          mutation: mutationEventEncoded.mutation,
          argsJson: mutationEventEncoded.args ?? {},
          clientId,
          sessionId,
          schemaHash: mutationDefSchemaHash,
          syncMetadataJson: mutationEventEncoded.meta.syncMetadata,
        },
      }),
    )
  })

export const updateSyncMetadata = (items: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>) =>
  Effect.gen(function* () {
    const { dbEventlog } = yield* LeaderThreadCtx

    // TODO try to do this in a single query
    for (let i = 0; i < items.length; i++) {
      const mutationEvent = items[i]!

      yield* execSql(
        dbEventlog,
        ...updateRows({
          tableName: EVENTLOG_META_TABLE,
          columns: eventlogMetaTable.sqliteDef.columns,
          where: { idGlobal: mutationEvent.id.global, idClient: mutationEvent.id.client },
          updateValues: { syncMetadataJson: mutationEvent.meta.syncMetadata },
        }),
      )
    }
  })

export const getSyncBackendCursorInfo = (remoteHead: EventId.GlobalEventId) =>
  Effect.gen(function* () {
    const { dbEventlog } = yield* LeaderThreadCtx

    if (remoteHead === EventId.ROOT.global) return Option.none()

    const EventlogQuerySchema = Schema.Struct({
      syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
    }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.head)

    const syncMetadataOption = yield* Effect.sync(() =>
      dbEventlog.select<{ syncMetadataJson: string }>(
        sql`SELECT syncMetadataJson FROM ${EVENTLOG_META_TABLE} WHERE idGlobal = ${remoteHead} ORDER BY idClient ASC LIMIT 1`,
      ),
    ).pipe(Effect.andThen(Schema.decode(EventlogQuerySchema)), Effect.map(Option.flatten), Effect.orDie)

    return Option.some({
      cursor: { global: remoteHead, client: EventId.clientDefault },
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  }).pipe(Effect.withSpan('@livestore/common:eventlog:getSyncBackendCursorInfo', { attributes: { remoteHead } }))
