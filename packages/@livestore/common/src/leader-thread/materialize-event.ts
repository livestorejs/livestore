import { LS_DEV, shouldNeverHappen } from '@livestore/utils'
import { Effect, ReadonlyArray, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import { getExecArgsFromEvent } from '../materializer-helper.js'
import type { LiveStoreSchema } from '../schema/mod.js'
import { EventId, getEventDef, SystemTables } from '../schema/mod.js'
import { insertRow } from '../sql-queries/index.js'
import { sql } from '../util.js'
import { execSql, execSqlPrepared } from './connection.js'
import * as Eventlog from './eventlog.js'
import type { MaterializeEvent } from './types.js'

export const makeMaterializeEvent = ({
  schema,
  dbState: db,
  dbEventlog,
}: {
  schema: LiveStoreSchema
  dbState: SqliteDb
  dbEventlog: SqliteDb
}): Effect.Effect<MaterializeEvent, never> =>
  Effect.gen(function* () {
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
        const { eventDef, materializer } = getEventDef(schema, eventName)

        const execArgsArr = getExecArgsFromEvent({
          eventDef,
          materializer,
          db,
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

        // console.group('[@livestore/common:leader-thread:materializeEvent]', { eventName })

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
            tableName: SystemTables.SESSION_CHANGESET_META_TABLE,
            columns: SystemTables.sessionChangesetMetaTable.sqliteDef.columns,
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
        if (skipEventlog === false) {
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
        Effect.withSpan(`@livestore/common:leader-thread:materializeEvent`, {
          attributes: {
            eventName: eventEncoded.name,
            eventId: eventEncoded.id,
            'span.label': `${EventId.toString(eventEncoded.id)} ${eventEncoded.name}`,
          },
        }),
        // Effect.logDuration('@livestore/common:leader-thread:materializeEvent'),
      )
  })

export const rollback = ({
  dbState,
  dbEventlog,
  eventIdsToRollback,
}: {
  dbState: SqliteDb
  dbEventlog: SqliteDb
  eventIdsToRollback: EventId.EventId[]
}) =>
  Effect.gen(function* () {
    const rollbackEvents = dbState
      .select<SystemTables.SessionChangesetMetaRow>(
        sql`SELECT * FROM ${SystemTables.SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.client})`).join(', ')})`,
      )
      .map((_) => ({ id: { global: _.idGlobal, client: _.idClient }, changeset: _.changeset, debug: _.debug }))
      .toSorted((a, b) => EventId.compare(a.id, b.id))

    // Apply changesets in reverse order
    for (let i = rollbackEvents.length - 1; i >= 0; i--) {
      const { changeset } = rollbackEvents[i]!
      if (changeset !== null) {
        dbState.makeChangeset(changeset).invert().apply()
      }
    }

    const eventIdPairChunks = ReadonlyArray.chunksOf(100)(
      eventIdsToRollback.map((id) => `(${id.global}, ${id.client})`),
    )

    // Delete the changeset rows
    for (const eventIdPairChunk of eventIdPairChunks) {
      dbState.execute(
        sql`DELETE FROM ${SystemTables.SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdPairChunk.join(', ')})`,
      )
    }

    // Delete the eventlog rows
    for (const eventIdPairChunk of eventIdPairChunks) {
      dbEventlog.execute(
        sql`DELETE FROM ${SystemTables.EVENTLOG_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdPairChunk.join(', ')})`,
      )
    }
  }).pipe(
    Effect.withSpan('@livestore/common:LeaderSyncProcessor:rollback', {
      attributes: { count: eventIdsToRollback.length },
    }),
  )
