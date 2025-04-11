import { memoizeByRef } from '@livestore/utils'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'

import { type MigrationOptionsFromEventlog, type SqliteDb, UnexpectedError } from './adapter-types.js'
import type { ApplyMutation } from './leader-thread/mod.js'
import type { EventDef, EventlogMetaRow, LiveStoreSchema } from './schema/mod.js'
import { EventId, EVENTLOG_META_TABLE, getEventDef, LiveStoreEvent } from './schema/mod.js'
import type { PreparedBindValues } from './util.js'
import { sql } from './util.js'

export const rehydrateFromEventlog = ({
  dbEventlog,
  // TODO re-use this db when bringing back the boot in-memory db implementation
  // db,
  schema,
  migrationOptions,
  onProgress,
  applyMutation,
}: {
  dbEventlog: SqliteDb
  // db: SqliteDb
  schema: LiveStoreSchema
  migrationOptions: MigrationOptionsFromEventlog
  onProgress: (_: { done: number; total: number }) => Effect.Effect<void>
  applyMutation: ApplyMutation
}) =>
  Effect.gen(function* () {
    const mutationsCount = dbEventlog.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${EVENTLOG_META_TABLE}`,
    )[0]!.count

    const hashMutation = memoizeByRef((mutation: EventDef.AnyWithoutFn) => Schema.hash(mutation.schema))

    const processMutation = (row: EventlogMetaRow) =>
      Effect.gen(function* () {
        const mutationDef = getEventDef(schema, row.mutation)

        if (migrationOptions.excludeMutations?.has(row.mutation) === true) return

        if (hashMutation(mutationDef.eventDef) !== row.schemaHash) {
          yield* Effect.logWarning(
            `Schema hash mismatch for mutation ${row.mutation}. Trying to apply mutation anyway.`,
          )
        }

        const args = JSON.parse(row.argsJson)

        // Checking whether the schema has changed in an incompatible way
        yield* Schema.decodeUnknown(mutationDef.eventDef.schema)(args).pipe(
          Effect.mapError((cause) =>
            UnexpectedError.make({
              cause,
              note: `\
There was an error during rehydrating from the mutation log while decoding
the persisted mutation event args for mutation "${row.mutation}".
This likely means the schema has changed in an incompatible way.
`,
            }),
          ),
        )

        const mutationEventEncoded = LiveStoreEvent.EncodedWithMeta.make({
          id: { global: row.idGlobal, client: row.idClient },
          parentId: { global: row.parentIdGlobal, client: row.parentIdClient },
          mutation: row.mutation,
          args,
          clientId: row.clientId,
          sessionId: row.sessionId,
        })

        yield* applyMutation(mutationEventEncoded, { skipEventlog: true })
      }).pipe(Effect.withSpan(`@livestore/common:rehydrateFromEventlog:processMutation`))

    const CHUNK_SIZE = 100

    const stmt = dbEventlog.prepare(sql`\
SELECT * FROM ${EVENTLOG_META_TABLE} 
WHERE idGlobal > $idGlobal OR (idGlobal = $idGlobal AND idClient > $idClient)
ORDER BY idGlobal ASC, idClient ASC
LIMIT ${CHUNK_SIZE}
`)

    let processedMutations = 0

    yield* Stream.unfoldChunk<Chunk.Chunk<EventlogMetaRow> | { _tag: 'Initial ' }, EventlogMetaRow>(
      { _tag: 'Initial ' },
      (item) => {
        // End stream if no more rows
        if (Chunk.isChunk(item) && item.length === 0) return Option.none()

        const lastId = Chunk.isChunk(item)
          ? Chunk.last(item).pipe(
              Option.map((_) => ({ global: _.idGlobal, client: _.idClient })),
              Option.getOrElse(() => EventId.ROOT),
            )
          : EventId.ROOT
        const nextItem = Chunk.fromIterable(
          stmt.select<EventlogMetaRow>({
            $idGlobal: lastId?.global,
            $idClient: lastId?.client,
          } as any as PreparedBindValues),
        )
        const prevItem = Chunk.isChunk(item) ? item : Chunk.empty()
        return Option.some([prevItem, nextItem])
      },
    ).pipe(
      Stream.bufferChunks({ capacity: 2 }),
      Stream.tap((row) =>
        Effect.gen(function* () {
          yield* processMutation(row)

          processedMutations++
          yield* onProgress({ done: processedMutations, total: mutationsCount })
        }),
      ),
      Stream.runDrain,
    )
  }).pipe(
    Effect.withPerformanceMeasure('@livestore/common:rehydrateFromEventlog'),
    Effect.withSpan('@livestore/common:rehydrateFromEventlog'),
  )
