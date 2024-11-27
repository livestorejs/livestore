import { isDevEnv, memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'

import {
  type MigrationOptionsFromMutationLog,
  ROOT_ID,
  type SynchronousDatabase,
  UnexpectedError,
} from './adapter-types.js'
import { getExecArgsFromMutation } from './mutation.js'
import type { LiveStoreSchema, MutationDef, MutationEvent, MutationLogMetaRow } from './schema/index.js'
import { MUTATION_LOG_META_TABLE } from './schema/index.js'
import type { PreparedBindValues } from './util.js'
import { sql } from './util.js'

export const rehydrateFromMutationLog = ({
  logDb,
  db,
  schema,
  migrationOptions,
  onProgress,
}: {
  logDb: SynchronousDatabase
  db: SynchronousDatabase
  schema: LiveStoreSchema
  migrationOptions: MigrationOptionsFromMutationLog
  onProgress: (_: { done: number; total: number }) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const mutationsCount = logDb.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${MUTATION_LOG_META_TABLE}`,
    )[0]!.count

    const hashMutation = memoizeByRef((mutation: MutationDef.Any) => Schema.hash(mutation.schema))

    const processMutation = (row: MutationLogMetaRow) =>
      Effect.gen(function* () {
        const mutationDef = schema.mutations.get(row.mutation) ?? shouldNeverHappen(`Unknown mutation ${row.mutation}`)

        if (migrationOptions.excludeMutations?.has(row.mutation) === true) return

        if (hashMutation(mutationDef) !== row.schemaHash) {
          yield* Effect.logWarning(
            `Schema hash mismatch for mutation ${row.mutation}. Trying to apply mutation anyway.`,
          )
        }

        const argsDecoded = yield* Schema.decodeUnknown(Schema.parseJson(mutationDef.schema))(row.argsJson).pipe(
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

        const mutationEventDecoded = {
          id: { global: row.idGlobal, local: row.idLocal },
          parentId: { global: row.parentIdGlobal, local: row.parentIdLocal },
          mutation: row.mutation,
          args: argsDecoded,
        } satisfies MutationEvent.Any

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        const makeExecuteOptions = (statementSql: string, bindValues: any) => ({
          onRowsChanged: (rowsChanged: number) => {
            if (rowsChanged === 0 && migrationOptions.logging?.excludeAffectedRows?.(statementSql) !== true) {
              console.warn(`Mutation "${mutationDef.name}" did not affect any rows:`, statementSql, bindValues)
            }
          },
        })

        for (const { statementSql, bindValues } of execArgsArr) {
          // TODO cache prepared statements for mutations
          db.execute(statementSql, bindValues, isDevEnv() ? makeExecuteOptions(statementSql, bindValues) : undefined)
          // console.log(`Re-executed mutation ${mutationSql}`, bindValues)
        }
      }).pipe(Effect.withSpan(`@livestore/common:rehydrateFromMutationLog:processMutation`))

    const CHUNK_SIZE = 100

    const stmt = logDb.prepare(sql`\
SELECT * FROM ${MUTATION_LOG_META_TABLE} 
WHERE idGlobal > $idGlobal OR (idGlobal = $idGlobal AND idLocal > $idLocal)
ORDER BY idGlobal ASC, idLocal ASC
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
              Option.map((_) => ({ global: _.idGlobal, local: _.idLocal })),
              Option.getOrElse(() => ROOT_ID),
            )
          : ROOT_ID
        const nextItem = Chunk.fromIterable(
          stmt.select<MutationLogMetaRow>({
            $idGlobal: lastId?.global,
            $idLocal: lastId?.local,
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
