import { LS_DEV, memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import { Effect, ReadonlyArray, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import { getExecArgsFromEvent } from '../materializer-helper.js'
import type { LiveStoreEvent, LiveStoreSchema, SessionChangesetMetaRow } from '../schema/mod.js'
import {
  EventId,
  EVENTLOG_META_TABLE,
  getEventDef,
  SESSION_CHANGESET_META_TABLE,
  sessionChangesetMetaTable,
} from '../schema/mod.js'
import { insertRow } from '../sql-queries/index.js'
import { sql } from '../util.js'
import { execSql, execSqlPrepared } from './connection.js'
import * as Eventlog from './eventlog.js'
import type { ApplyEvent } from './types.js'

export const makeApplyEvent = ({
  schema,
  dbReadModel: db,
  dbEventlog,
}: {
  schema: LiveStoreSchema
  dbReadModel: SqliteDb
  dbEventlog: SqliteDb
}): Effect.Effect<ApplyEvent, never> =>
  Effect.gen(function* () {
    const shouldExcludeEventFromLog = makeShouldExcludeEventFromLog(schema)

    const eventDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...schema.eventsDefsMap.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    return (eventEncoded, options) =>
      Effect.gen(function* () {
        const skipEventlog = options?.skipEventlog ?? false

        const eventName = eventEncoded.name
        const eventDef = getEventDef(schema, eventName)

        const execArgsArr = getExecArgsFromEvent({
          eventDef,
          event: { decoded: undefined, encoded: eventEncoded },
        })

        // NOTE we might want to bring this back if we want to debug no-op events
        // const makeExecuteOptions = (statementSql: string, bindValues: any) => ({
        //   onRowsChanged: (rowsChanged: number) => {
        //     if (rowsChanged === 0) {
        //       console.warn(`Event "${eventDef.name}" did not affect any rows:`, statementSql, bindValues)
        //     }
        //   },
        // })

        // console.group('[@livestore/common:leader-thread:applyEvent]', { eventName })

        const session = db.session()

        for (const { statementSql, bindValues } of execArgsArr) {
          // console.debug(eventName, statementSql, bindValues)
          // TODO use cached prepared statements instead of exec
          yield* execSqlPrepared(db, statementSql, bindValues)
        }

        const changeset = session.changeset()
        session.finish()

        // TODO use prepared statements
        yield* execSql(
          db,
          ...insertRow({
            tableName: SESSION_CHANGESET_META_TABLE,
            columns: sessionChangesetMetaTable.sqliteDef.columns,
            values: {
              idGlobal: eventEncoded.id.global,
              idClient: eventEncoded.id.client,
              // NOTE the changeset will be empty (i.e. null) for no-op events
              changeset: changeset ?? null,
              debug: LS_DEV ? execArgsArr : null,
            },
          }),
        )

        // console.groupEnd()

        // write to eventlog
        const excludeFromEventlog = shouldExcludeEventFromLog(eventName, eventEncoded)
        if (skipEventlog === false && excludeFromEventlog === false) {
          const eventName = eventEncoded.name
          const eventDefSchemaHash =
            eventDefSchemaHashMap.get(eventName) ?? shouldNeverHappen(`Unknown event definition: ${eventName}`)

          yield* Eventlog.insertIntoEventlog(
            eventEncoded,
            dbEventlog,
            eventDefSchemaHash,
            eventEncoded.clientId,
            eventEncoded.sessionId,
          )
        } else {
          //   console.debug('[@livestore/common:leader-thread] skipping eventlog write', mutation, statementSql, bindValues)
        }

        return {
          sessionChangeset: changeset
            ? {
                _tag: 'sessionChangeset' as const,
                data: changeset,
                debug: LS_DEV ? execArgsArr : null,
              }
            : { _tag: 'no-op' as const },
        }
      }).pipe(
        Effect.withSpan(`@livestore/common:leader-thread:applyEvent`, {
          attributes: {
            eventName: eventEncoded.name,
            mutationId: eventEncoded.id,
            'span.label': `${EventId.toString(eventEncoded.id)} ${eventEncoded.name}`,
          },
        }),
        // Effect.logDuration('@livestore/common:leader-thread:applyEvent'),
      )
  })

export const rollback = ({
  db,
  dbEventlog,
  eventIdsToRollback,
}: {
  db: SqliteDb
  dbEventlog: SqliteDb
  eventIdsToRollback: EventId.EventId[]
}) =>
  Effect.gen(function* () {
    const rollbackEvents = db
      .select<SessionChangesetMetaRow>(
        sql`SELECT * FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.client})`).join(', ')})`,
      )
      .map((_) => ({ id: { global: _.idGlobal, client: _.idClient }, changeset: _.changeset, debug: _.debug }))
      .toSorted((a, b) => EventId.compare(a.id, b.id))

    // Apply changesets in reverse order
    for (let i = rollbackEvents.length - 1; i >= 0; i--) {
      const { changeset } = rollbackEvents[i]!
      if (changeset !== null) {
        db.makeChangeset(changeset).invert().apply()
      }
    }

    const eventIdPairChunks = ReadonlyArray.chunksOf(100)(
      eventIdsToRollback.map((id) => `(${id.global}, ${id.client})`),
    )

    // Delete the changeset rows
    for (const eventIdPairChunk of eventIdPairChunks) {
      db.execute(
        sql`DELETE FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdPairChunk.join(', ')})`,
      )
    }

    // Delete the eventlog rows
    for (const eventIdPairChunk of eventIdPairChunks) {
      dbEventlog.execute(
        sql`DELETE FROM ${EVENTLOG_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdPairChunk.join(', ')})`,
      )
    }
  }).pipe(
    Effect.withSpan('@livestore/common:LeaderSyncProcessor:rollback', {
      attributes: { count: eventIdsToRollback.length },
    }),
  )

// TODO let's consider removing this "should exclude" mechanism in favour of log compaction etc
const makeShouldExcludeEventFromLog = memoizeByRef((schema: LiveStoreSchema) => {
  const migrationOptions = schema.migrationOptions
  const eventlogExclude =
    migrationOptions.strategy === 'from-eventlog'
      ? (migrationOptions.excludeEvents ?? new Set(['livestore.RawSql']))
      : new Set(['livestore.RawSql'])

  return (eventName: string, eventEncoded: LiveStoreEvent.AnyEncoded): boolean => {
    if (eventlogExclude.has(eventName)) return true

    const eventDef = getEventDef(schema, eventName)
    const execArgsArr = getExecArgsFromEvent({
      eventDef,
      event: { decoded: undefined, encoded: eventEncoded },
    })

    return execArgsArr.some((_) => _.statementSql.includes('__livestore'))
  }
})
