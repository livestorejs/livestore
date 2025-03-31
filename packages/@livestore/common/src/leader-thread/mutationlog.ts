import { Effect, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import * as EventId from '../schema/EventId.js'
import * as MutationEvent from '../schema/MutationEvent.js'
import {
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  sessionChangesetMetaTable,
  SYNC_STATUS_TABLE,
} from '../schema/system-tables.js'
import { prepareBindValues, sql } from '../util.js'
import { LeaderThreadCtx } from './types.js'

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
      .map((_) =>
        MutationEvent.EncodedWithMeta.make({
          mutation: _.mutation,
          args: _.argsJson,
          id: { global: _.idGlobal, client: _.idClient },
          parentId: { global: _.parentIdGlobal, client: _.parentIdClient },
          clientId: _.clientId,
          sessionId: _.sessionId,
          meta: {
            sessionChangeset:
              sessionChangesetRowsDecoded.find((_) => _.idGlobal === _.idGlobal && _.idClient === _.idClient)
                ?.changeset ?? 'unset',
          },
        }),
      )
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
