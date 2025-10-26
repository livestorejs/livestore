import { isDevEnv, LS_DEV, shouldNeverHappen } from '@livestore/utils'
import { Effect, Option, ReadonlyArray, Schema } from '@livestore/utils/effect'

import { MaterializeError, MaterializerHashMismatchError, type SqliteDb } from '../adapter-types.ts'
import { getExecStatementsFromMaterializer, hashMaterializerResults } from '../materializer-helper.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { EventSequenceNumber, resolveEventDef, SystemTables, UNKNOWN_EVENT_SCHEMA_HASH } from '../schema/mod.ts'
import { insertRow } from '../sql-queries/index.ts'
import { sql } from '../util.ts'
import { execSql, execSqlPrepared } from './connection.ts'
import * as Eventlog from './eventlog.ts'
import type { MaterializeEvent } from './types.ts'

// TODO refactor `makeMaterializeEvent` to not return an Effect for the constructor as it's not needed
export const makeMaterializeEvent = ({
  schema,
  dbState,
  dbEventlog,
}: {
  schema: LiveStoreSchema
  dbState: SqliteDb
  dbEventlog: SqliteDb
}): Effect.Effect<MaterializeEvent> =>
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

        const resolution = yield* resolveEventDef(schema, {
          operation: '@livestore/common:leader-thread:materializeEvent',
          event: eventEncoded,
        })

        if (resolution._tag === 'unknown') {
          // Unknown events still enter the eventlog so newer clients can replay
          // them once they learn the schema. We skip materialization to keep the
          // local state consistent with the knowledge of the current client.
          if (skipEventlog === false) {
            yield* Eventlog.insertIntoEventlog(
              eventEncoded,
              dbEventlog,
              UNKNOWN_EVENT_SCHEMA_HASH,
              eventEncoded.clientId,
              eventEncoded.sessionId,
            )
          }

          dbState.debug.head = eventEncoded.seqNum

          return {
            sessionChangeset: { _tag: 'no-op' as const },
            hash: Option.none(),
          }
        }

        const { eventDef, materializer } = resolution

        const execArgsArr = getExecStatementsFromMaterializer({
          eventDef,
          materializer,
          dbState,
          event: { decoded: undefined, encoded: eventEncoded },
        })

        const materializerHash = isDevEnv() ? Option.some(hashMaterializerResults(execArgsArr)) : Option.none()

        if (
          materializerHash._tag === 'Some' &&
          eventEncoded.meta.materializerHashSession._tag === 'Some' &&
          eventEncoded.meta.materializerHashSession.value !== materializerHash.value
        ) {
          return yield* MaterializerHashMismatchError.make({ eventName: eventEncoded.name })
        }

        // NOTE we might want to bring this back if we want to debug no-op events
        // const makeExecuteOptions = (statementSql: string, bindValues: any) => ({
        //   onRowsChanged: (rowsChanged: number) => {
        //     if (rowsChanged === 0) {
        //       console.warn(`Event "${eventDef.name}" did not affect any rows:`, statementSql, bindValues)
        //     }
        //   },
        // })

        // console.group('[@livestore/common:leader-thread:materializeEvent]', { eventName })

        const session = dbState.session()

        for (const { statementSql, bindValues } of execArgsArr) {
          // console.debug(eventName, statementSql, bindValues)
          // TODO use cached prepared statements instead of exec
          yield* execSqlPrepared(dbState, statementSql, bindValues)
        }

        dbState.debug.head = eventEncoded.seqNum

        const changeset = session.changeset()
        session.finish()

        // TODO use prepared statements
        yield* execSql(
          dbState,
          ...insertRow({
            tableName: SystemTables.SESSION_CHANGESET_META_TABLE,
            columns: SystemTables.sessionChangesetMetaTable.sqliteDef.columns,
            values: {
              seqNumGlobal: eventEncoded.seqNum.global,
              seqNumClient: eventEncoded.seqNum.client,
              seqNumRebaseGeneration: eventEncoded.seqNum.rebaseGeneration,
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
          hash: materializerHash,
        }
      }).pipe(
        Effect.mapError((cause) => MaterializeError.make({ cause })),
        Effect.withSpan(`@livestore/common:leader-thread:materializeEvent`, {
          attributes: {
            eventName: eventEncoded.name,
            eventNum: eventEncoded.seqNum,
            'span.label': `${EventSequenceNumber.toString(eventEncoded.seqNum)} ${eventEncoded.name}`,
          },
        }),
        // Effect.logDuration('@livestore/common:leader-thread:materializeEvent'),
      )
  })

export const rollback = ({
  dbState,
  dbEventlog,
  eventNumsToRollback,
}: {
  dbState: SqliteDb
  dbEventlog: SqliteDb
  eventNumsToRollback: EventSequenceNumber.EventSequenceNumber[]
}) =>
  Effect.gen(function* () {
    const rollbackEvents = dbState
      .select<SystemTables.SessionChangesetMetaRow>(
        sql`SELECT * FROM ${SystemTables.SESSION_CHANGESET_META_TABLE} WHERE (seqNumGlobal, seqNumClient) IN (${eventNumsToRollback.map((id) => `(${id.global}, ${id.client})`).join(', ')})`,
      )
      .map((_) => ({
        seqNum: {
          global: _.seqNumGlobal,
          client: _.seqNumClient,
          rebaseGeneration: -1, // unused in this code path
        },
        changeset: _.changeset,
        debug: _.debug,
      }))
      .toSorted((a, b) => EventSequenceNumber.compare(a.seqNum, b.seqNum))

    // Apply changesets in reverse order
    for (let i = rollbackEvents.length - 1; i >= 0; i--) {
      const { changeset } = rollbackEvents[i]!
      if (changeset !== null) {
        dbState.makeChangeset(changeset).invert().apply()
      }
    }

    const eventNumPairChunks = ReadonlyArray.chunksOf(100)(
      eventNumsToRollback.map((seqNum) => `(${seqNum.global}, ${seqNum.client})`),
    )

    // Delete the changeset rows
    for (const eventNumPairChunk of eventNumPairChunks) {
      dbState.execute(
        sql`DELETE FROM ${SystemTables.SESSION_CHANGESET_META_TABLE} WHERE (seqNumGlobal, seqNumClient) IN (${eventNumPairChunk.join(', ')})`,
      )
    }

    // Delete the eventlog rows
    for (const eventNumPairChunk of eventNumPairChunks) {
      dbEventlog.execute(
        sql`DELETE FROM ${SystemTables.EVENTLOG_META_TABLE} WHERE (seqNumGlobal, seqNumClient) IN (${eventNumPairChunk.join(', ')})`,
      )
    }
  }).pipe(
    Effect.withSpan('@livestore/common:LeaderSyncProcessor:rollback', {
      attributes: { count: eventNumsToRollback.length },
    }),
  )
