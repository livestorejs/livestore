import { isDevEnv, LS_DEV, shouldNeverHappen } from '@livestore/utils'
import { Effect, Option, Schema } from '@livestore/utils/effect'

import { MaterializeError, MaterializerHashMismatchError, type SqliteDb } from '../adapter-types.ts'
import * as MaterializationJournal from '../MaterializationJournal.ts'
import { getExecStatementsFromMaterializer, hashMaterializerResults } from '../materializer-helper.ts'
import { logDeprecationWarnings } from '../schema/EventDef/deprecated.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import { EventSequenceNumber, resolveEventDef, UNKNOWN_EVENT_SCHEMA_HASH } from '../schema/mod.ts'
import * as StateHead from '../StateHead.ts'
import { execSqlPrepared } from './connection.ts'
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
}): Effect.Effect<MaterializeEvent, never, MaterializationJournal.MaterializationJournal | StateHead.StateHead> =>
  Effect.gen(function* () {
    const materializationJournal = yield* MaterializationJournal.MaterializationJournal
    const stateHead = yield* StateHead.StateHead
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

          yield* materializationJournal.record({
            key: eventEncoded.seqNum,
            sessionChangeset: { _tag: 'no-op' },
          })

          dbState.debug.head = eventEncoded.seqNum
          yield* stateHead.set(eventEncoded.seqNum)

          return
        }

        const { eventDef, materializer } = resolution

        // Log deprecation warnings for deprecated events/fields
        yield* logDeprecationWarnings(eventDef, eventEncoded.args as Record<string, unknown>)

        const execArgsArr = getExecStatementsFromMaterializer({
          eventDef,
          materializer,
          dbState,
          event: { decoded: undefined, encoded: eventEncoded },
        })

        const materializerHash = isDevEnv() === true ? Option.some(hashMaterializerResults(execArgsArr)) : Option.none()

        if (
          materializerHash._tag === 'Some' &&
          eventEncoded.meta.materializerHashSession._tag === 'Some' &&
          eventEncoded.meta.materializerHashSession.value !== materializerHash.value
        ) {
          return yield* MaterializerHashMismatchError.make({ eventName: eventEncoded.name })
        }

        eventEncoded.meta.materializerHashLeader = materializerHash

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

        const changeset = session.changeset()
        session.finish()

        yield* materializationJournal.record({
          key: eventEncoded.seqNum,
          sessionChangeset:
            changeset !== undefined
              ? { _tag: 'sessionChangeset' as const, data: changeset, debug: LS_DEV === true ? execArgsArr : null }
              : { _tag: 'no-op' as const },
        })

        dbState.debug.head = eventEncoded.seqNum
        yield* stateHead.set(eventEncoded.seqNum)

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

        return
      }).pipe(
        Effect.mapError((cause) => MaterializeError.make({ cause })),
        Effect.withSpan(`@livestore/common:leader-thread:materializeEvent`, {
          attributes: {
            eventName: eventEncoded.name,
            eventNum: eventEncoded.seqNum,
            'span.label': `${EventSequenceNumber.Client.toString(eventEncoded.seqNum)} ${eventEncoded.name}`,
          },
        }),
        // Effect.logDuration('@livestore/common:leader-thread:materializeEvent'),
      )
  })
