import { Effect, Schema } from '@livestore/utils/effect'

import type { SynchronousDatabase } from '../adapter-types.js'
import * as EventId from '../schema/EventId.js'
import { MUTATION_LOG_META_TABLE, mutationLogMetaTable, SYNC_STATUS_TABLE } from '../schema/system-tables.js'
import { prepareBindValues, sql } from '../util.js'
import { LeaderThreadCtx } from './types.js'

export const getMutationEventsSince = (since: EventId.EventId) =>
  Effect.gen(function* () {
    const { dbLog } = yield* LeaderThreadCtx

    const query = mutationLogMetaTable.query.where('idGlobal', '>=', since.global).asSql()
    const pendingMutationEventsRaw = dbLog.select(query.query, prepareBindValues(query.bindValues, query.query))
    const pendingMutationEvents = Schema.decodeUnknownSync(mutationLogMetaTable.schema.pipe(Schema.Array))(
      pendingMutationEventsRaw,
    )

    return pendingMutationEvents
      .map((_) => ({
        mutation: _.mutation,
        args: _.argsJson,
        id: { global: _.idGlobal, local: _.idLocal },
        parentId: { global: _.parentIdGlobal, local: _.parentIdLocal },
      }))
      .filter((_) => EventId.compare(_.id, since) > 0)
  })

export const getLocalHeadFromDb = (dbLog: SynchronousDatabase) => {
  const res = dbLog.select<{ idGlobal: number; idLocal: number }>(
    sql`select idGlobal, idLocal from ${MUTATION_LOG_META_TABLE} order by idGlobal DESC, idLocal DESC limit 1`,
  )[0]

  return res ? { global: res.idGlobal, local: res.idLocal } : EventId.ROOT
}

export const getBackendHeadFromDb = (dbLog: SynchronousDatabase) =>
  dbLog.select<{ head: number }>(sql`select head from ${SYNC_STATUS_TABLE}`)[0]?.head ?? EventId.ROOT.global

// TODO use prepared statements
export const updateBackendHead = (dbLog: SynchronousDatabase, head: EventId.EventId) =>
  dbLog.execute(sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${head.global}`)
