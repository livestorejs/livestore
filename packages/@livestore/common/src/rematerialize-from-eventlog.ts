import { memoizeByRef } from '@livestore/utils'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'

import { type SqliteDb, UnexpectedError } from './adapter-types.js'
import type { MaterializeEvent } from './leader-thread/mod.js'
import type { EventDef, LiveStoreSchema } from './schema/mod.js'
import { EventSequenceNumber, getEventDef, LiveStoreEvent, SystemTables } from './schema/mod.js'
import type { PreparedBindValues } from './util.js'
import { sql } from './util.js'

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
        const eventDef = getEventDef(schema, row.name)

        if (hashEventDef(eventDef.eventDef) !== row.schemaHash) {
          yield* Effect.logWarning(
            `Schema hash mismatch for event definition ${row.name}. Trying to materialize event anyway.`,
          )
        }

        const args = JSON.parse(row.argsJson)

        // Checking whether the schema has changed in an incompatible way
        yield* Schema.decodeUnknown(eventDef.eventDef.schema)(args).pipe(
          Effect.mapError((cause) =>
            UnexpectedError.make({
              cause,
              note: `\
There was an error during rematerializing from the eventlog while decoding
the persisted event args for event definition "${row.name}".
This likely means the schema has changed in an incompatible way.
`,
            }),
          ),
        )

        const eventEncoded = LiveStoreEvent.EncodedWithMeta.make({
          seqNum: { global: row.seqNumGlobal, client: row.seqNumClient },
          parentSeqNum: { global: row.parentSeqNumGlobal, client: row.parentSeqNumClient },
          name: row.name,
          args,
          clientId: row.clientId,
          sessionId: row.sessionId,
        })

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
      Chunk.Chunk<SystemTables.EventlogMetaRow> | { _tag: 'Initial ' },
      SystemTables.EventlogMetaRow
    >({ _tag: 'Initial ' }, (item) => {
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
