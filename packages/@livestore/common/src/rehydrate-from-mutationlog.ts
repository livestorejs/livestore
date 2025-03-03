import { memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'

import { type MigrationOptionsFromMutationLog, type SqliteDb, UnexpectedError } from './adapter-types.js'
import { makeApplyMutation } from './leader-thread/apply-mutation.js'
import type { LiveStoreSchema, MutationDef, MutationEvent, MutationLogMetaRow } from './schema/mod.js'
import { EventId, getMutationDef, MUTATION_LOG_META_TABLE } from './schema/mod.js'
import type { PreparedBindValues } from './util.js'
import { sql } from './util.js'

export const rehydrateFromMutationLog = ({
  logDb,
  // TODO re-use this db when bringing back the boot in-memory db implementation
  // db,
  schema,
  migrationOptions,
  onProgress,
}: {
  logDb: SqliteDb
  db: SqliteDb
  schema: LiveStoreSchema
  migrationOptions: MigrationOptionsFromMutationLog
  onProgress: (_: { done: number; total: number }) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const mutationsCount = logDb.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${MUTATION_LOG_META_TABLE}`,
    )[0]!.count

    const hashMutation = memoizeByRef((mutation: MutationDef.Any) => Schema.hash(mutation.schema))

    const applyMutation = yield* makeApplyMutation

    const processMutation = (row: MutationLogMetaRow) =>
      Effect.gen(function* () {
        const mutationDef = getMutationDef(schema, row.mutation)

        if (migrationOptions.excludeMutations?.has(row.mutation) === true) return

        if (hashMutation(mutationDef) !== row.schemaHash) {
          yield* Effect.logWarning(
            `Schema hash mismatch for mutation ${row.mutation}. Trying to apply mutation anyway.`,
          )
        }

        const args = JSON.parse(row.argsJson)

        // Checking whether the schema has changed in an incompatible way
        yield* Schema.decodeUnknown(mutationDef.schema)(args).pipe(
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

        const mutationEventEncoded = {
          id: { global: row.idGlobal, client: row.idClient },
          parentId: { global: row.parentIdGlobal, client: row.parentIdClient },
          mutation: row.mutation,
          args,
          clientId: row.clientId,
          sessionId: row.sessionId ?? undefined,
        } satisfies MutationEvent.AnyEncoded

        yield* applyMutation(mutationEventEncoded, { skipMutationLog: true })
      }).pipe(Effect.withSpan(`@livestore/common:rehydrateFromMutationLog:processMutation`))

    const CHUNK_SIZE = 100

    const stmt = logDb.prepare(sql`\
SELECT * FROM ${MUTATION_LOG_META_TABLE} 
WHERE idGlobal > $idGlobal OR (idGlobal = $idGlobal AND idClient > $idClient)
ORDER BY idGlobal ASC, idClient ASC
LIMIT ${CHUNK_SIZE}
`)

    let processedMutations = 0

    yield* Stream.unfoldChunk<Chunk.Chunk<MutationLogMetaRow> | { _tag: 'Initial ' }, MutationLogMetaRow>(
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
          stmt.select<MutationLogMetaRow>({
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
    Effect.withPerformanceMeasure('@livestore/common:rehydrateFromMutationLog'),
    Effect.withSpan('@livestore/common:rehydrateFromMutationLog'),
  )
