import { memoizeByRef } from '@livestore/utils'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'

import { type SqliteDb, UnknownError } from './adapter-types.ts'
import type { MaterializeEvent } from './leader-thread/mod.ts'
import type { EventDef, LiveStoreSchema } from './schema/mod.ts'
import { EventSequenceNumber, LiveStoreEvent, resolveEventDef, SystemTables } from './schema/mod.ts'
import type { PreparedBindValues } from './util.ts'
import { sql } from './util.ts'

export const rematerializeFromEventlog = ({
  dbEventlog,
  // TODO re-use this db when bringing back the boot in-memory db implementation
  // db,
  schema,
  onProgress,
  materializeEvent,
}: {
  dbEventlog: SqliteDb
  // db: SqliteDb
  schema: LiveStoreSchema
  onProgress: (_: { done: number; total: number }) => Effect.Effect<void>
  materializeEvent: MaterializeEvent
}) =>
  Effect.gen(function* () {
    const eventsCount = dbEventlog.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${SystemTables.EVENTLOG_META_TABLE}`,
    )[0]!.count

    const hashEventDef = memoizeByRef((event: EventDef.AnyWithoutFn) => Schema.hash(event.schema))

    const processEvent = (row: SystemTables.EventlogMetaRow) =>
      Effect.gen(function* () {
        const args = JSON.parse(row.argsJson)
        const eventEncoded = LiveStoreEvent.EncodedWithMeta.make({
          name: row.name,
          args,
          seqNum: {
            global: row.seqNumGlobal,
            client: row.seqNumClient,
            rebaseGeneration: row.seqNumRebaseGeneration,
          },
          parentSeqNum: {
            global: row.parentSeqNumGlobal,
            client: row.parentSeqNumClient,
            rebaseGeneration: row.parentSeqNumRebaseGeneration,
          },
          clientId: row.clientId,
          sessionId: row.sessionId,
        })

        const resolution = yield* resolveEventDef(schema, {
          operation: '@livestore/common:rematerializeFromEventlog:processEvent',
          event: eventEncoded,
        }).pipe(UnknownError.mapToUnknownError)

        if (resolution._tag === 'unknown') {
          // Old snapshots can contain newer events. Skip until the runtime has
          // been updated; the event stays in the log for future replays.
          return
        }

        const { eventDef } = resolution

        if (hashEventDef(eventDef) !== row.schemaHash) {
          yield* Effect.logWarning(
            `Schema hash mismatch for event definition ${row.name}. Trying to materialize event anyway.`,
          )
        }

        // Checking whether the schema has changed in an incompatible way
        yield* Schema.decodeUnknown(eventDef.schema)(args).pipe(
          Effect.mapError((cause) =>
            UnknownError.make({
              cause,
              note: `\
There was an error during rematerializing from the eventlog while decoding
the persisted event args for event definition "${row.name}".
This likely means the schema has changed in an incompatible way.
`,
            }),
          ),
        )

        yield* materializeEvent(eventEncoded, { skipEventlog: true })
      }).pipe(Effect.withSpan(`@livestore/common:rematerializeFromEventlog:processEvent`))

    const CHUNK_SIZE = 100

    const stmt = dbEventlog.prepare(sql`\
SELECT * FROM ${SystemTables.EVENTLOG_META_TABLE} 
WHERE seqNumGlobal > $seqNumGlobal OR (seqNumGlobal = $seqNumGlobal AND seqNumClient > $seqNumClient)
ORDER BY seqNumGlobal ASC, seqNumClient ASC
LIMIT ${CHUNK_SIZE}
`)

    let processedEvents = 0

    yield* Stream.unfoldChunk<
      Chunk.Chunk<SystemTables.EventlogMetaRow> | { _tag: 'Initial' },
      SystemTables.EventlogMetaRow
    >({ _tag: 'Initial' }, (item) => {
      // End stream if no more rows
      if (Chunk.isChunk(item) && item.length === 0) return Option.none()

      const lastId = Chunk.isChunk(item)
        ? Chunk.last(item).pipe(
            Option.map((_) => ({ global: _.seqNumGlobal, client: _.seqNumClient })),
            Option.getOrElse(() => EventSequenceNumber.ROOT),
          )
        : EventSequenceNumber.ROOT
      const nextItem = Chunk.fromIterable(
        stmt.select<SystemTables.EventlogMetaRow>({
          $seqNumGlobal: lastId?.global,
          $seqNumClient: lastId?.client,
        } as any as PreparedBindValues),
      )
      const prevItem = Chunk.isChunk(item) ? item : Chunk.empty()
      return Option.some([prevItem, nextItem])
    }).pipe(
      Stream.bufferChunks({ capacity: 2 }),
      Stream.tap((row) =>
        Effect.gen(function* () {
          yield* processEvent(row)

          processedEvents++
          yield* onProgress({ done: processedEvents, total: eventsCount })
        }),
      ),
      Stream.runDrain,
    )
  }).pipe(
    Effect.withPerformanceMeasure('@livestore/common:rematerializeFromEventlog'),
    Effect.withSpan('@livestore/common:rematerializeFromEventlog'),
  )
