import { LS_DEV, shouldNeverHappen } from '@livestore/utils'
import { Effect, Option, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import * as EventId from '../schema/EventId.js'
import * as MutationEvent from '../schema/MutationEvent.js'
import {
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
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

export const initMutationLogDb = (dbMutationLog: SqliteDb) =>
  Effect.gen(function* () {
    yield* migrateTable({
      db: dbMutationLog,
      behaviour: 'create-if-not-exists',
      tableAst: mutationLogMetaTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    yield* migrateTable({
      db: dbMutationLog,
      behaviour: 'create-if-not-exists',
      tableAst: syncStatusTable.sqliteDef.ast,
      skipMetaTable: true,
    })

    // Create sync status row if it doesn't exist
    yield* execSql(
      dbMutationLog,
      sql`INSERT INTO ${SYNC_STATUS_TABLE} (head)
          SELECT ${EventId.ROOT.global}
          WHERE NOT EXISTS (SELECT 1 FROM ${SYNC_STATUS_TABLE})`,
      {},
    )
  })

/** Exclusive of the "since event" */
export const getMutationEventsSince = (
  since: EventId.EventId,
): Effect.Effect<ReadonlyArray<MutationEvent.EncodedWithMeta>, never, LeaderThreadCtx> =>
  Effect.gen(function* () {
    const { dbMutationLog, dbReadModel } = yield* LeaderThreadCtx

    const query = mutationLogMetaTable.query.where('idGlobal', '>=', since.global).asSql()
    const pendingMutationEventsRaw = dbMutationLog.select(query.query, prepareBindValues(query.bindValues, query.query))
    const pendingMutationEvents = Schema.decodeUnknownSync(mutationLogMetaTable.schema.pipe(Schema.Array))(
      pendingMutationEventsRaw,
    )

    const sessionChangesetRows = sessionChangesetMetaTable.query.where('idGlobal', '>=', since.global).asSql()
    const sessionChangesetRowsRaw = dbReadModel.select(
      sessionChangesetRows.query,
      prepareBindValues(sessionChangesetRows.bindValues, sessionChangesetRows.query),
    )
    const sessionChangesetRowsDecoded = Schema.decodeUnknownSync(sessionChangesetMetaTable.schema.pipe(Schema.Array))(
      sessionChangesetRowsRaw,
    )

    return pendingMutationEvents
      .map((mutationLogEvent) => {
        const sessionChangeset = sessionChangesetRowsDecoded.find(
          (readModelEvent) =>
            readModelEvent.idGlobal === mutationLogEvent.idGlobal &&
            readModelEvent.idClient === mutationLogEvent.idClient,
        )
        return MutationEvent.EncodedWithMeta.make({
          mutation: mutationLogEvent.mutation,
          args: mutationLogEvent.argsJson,
          id: { global: mutationLogEvent.idGlobal, client: mutationLogEvent.idClient },
          parentId: { global: mutationLogEvent.parentIdGlobal, client: mutationLogEvent.parentIdClient },
          clientId: mutationLogEvent.clientId,
          sessionId: mutationLogEvent.sessionId,
          meta: {
            sessionChangeset:
              sessionChangeset && sessionChangeset.changeset !== null
                ? {
                    _tag: 'sessionChangeset' as const,
                    data: sessionChangeset.changeset,
                    debug: sessionChangeset.debug,
                  }
                : { _tag: 'unset' as const },
            syncMetadata: mutationLogEvent.syncMetadataJson,
          },
        })
      })
      .filter((_) => EventId.compare(_.id, since) > 0)
      .sort((a, b) => EventId.compare(a.id, b.id))
  })

export const getClientHeadFromDb = (dbMutationLog: SqliteDb): EventId.EventId => {
  const res = dbMutationLog.select<{ idGlobal: EventId.GlobalEventId; idClient: EventId.ClientEventId }>(
    sql`select idGlobal, idClient from ${MUTATION_LOG_META_TABLE} order by idGlobal DESC, idClient DESC limit 1`,
  )[0]

  return res ? { global: res.idGlobal, client: res.idClient } : EventId.ROOT
}

export const getBackendHeadFromDb = (dbMutationLog: SqliteDb): EventId.GlobalEventId =>
  dbMutationLog.select<{ head: EventId.GlobalEventId }>(sql`select head from ${SYNC_STATUS_TABLE}`)[0]?.head ??
  EventId.ROOT.global

// TODO use prepared statements
export const updateBackendHead = (dbMutationLog: SqliteDb, head: EventId.EventId) =>
  dbMutationLog.execute(sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${head.global}`)

export const insertIntoMutationLog = (
  mutationEventEncoded: MutationEvent.EncodedWithMeta,
  dbMutationLog: SqliteDb,
  mutationDefSchemaHash: number,
  clientId: string,
  sessionId: string,
) =>
  Effect.gen(function* () {
    // Check history consistency during LS_DEV
    if (LS_DEV && mutationEventEncoded.parentId.global !== EventId.ROOT.global) {
      const parentMutationExists =
        dbMutationLog.select<{ count: number }>(
          `SELECT COUNT(*) as count FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ? AND idClient = ?`,
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
      dbMutationLog,
      ...insertRow({
        tableName: MUTATION_LOG_META_TABLE,
        columns: mutationLogMetaTable.sqliteDef.columns,
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

export const updateSyncMetadata = (items: ReadonlyArray<MutationEvent.EncodedWithMeta>) =>
  Effect.gen(function* () {
    const { dbMutationLog } = yield* LeaderThreadCtx

    // TODO try to do this in a single query
    for (let i = 0; i < items.length; i++) {
      const mutationEvent = items[i]!

      yield* execSql(
        dbMutationLog,
        ...updateRows({
          tableName: MUTATION_LOG_META_TABLE,
          columns: mutationLogMetaTable.sqliteDef.columns,
          where: { idGlobal: mutationEvent.id.global, idClient: mutationEvent.id.client },
          updateValues: { syncMetadataJson: mutationEvent.meta.syncMetadata },
        }),
      )
    }
  })

export const getSyncBackendCursorInfo = (remoteHead: EventId.GlobalEventId) =>
  Effect.gen(function* () {
    const { dbMutationLog } = yield* LeaderThreadCtx

    if (remoteHead === EventId.ROOT.global) return Option.none()

    const MutationlogQuerySchema = Schema.Struct({
      syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
    }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.head)

    const syncMetadataOption = yield* Effect.sync(() =>
      dbMutationLog.select<{ syncMetadataJson: string }>(
        sql`SELECT syncMetadataJson FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ${remoteHead} ORDER BY idClient ASC LIMIT 1`,
      ),
    ).pipe(Effect.andThen(Schema.decode(MutationlogQuerySchema)), Effect.map(Option.flatten), Effect.orDie)

    return Option.some({
      cursor: { global: remoteHead, client: EventId.clientDefault },
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  }).pipe(Effect.withSpan('@livestore/common:mutationlog:getSyncBackendCursorInfo', { attributes: { remoteHead } }))
