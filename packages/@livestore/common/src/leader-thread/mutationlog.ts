import { Effect, Schema } from '@livestore/utils/effect'

import type { EventId } from '../adapter-types.js'
import { compareEventIds } from '../adapter-types.js'
import { mutationLogMetaTable } from '../schema/system-tables.js'
import { prepareBindValues } from '../util.js'
import { LeaderThreadCtx } from './types.js'

export const getNewMutationEvents = (since: EventId) =>
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
      .filter((_) => compareEventIds(_.id, since) > 0)
  })
