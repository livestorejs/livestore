import { shouldNeverHappen } from '@livestore/utils'
import { Chunk, Effect, Option, Schema, Stream } from '@livestore/utils/effect'

import { type InMemoryDatabase, type MigrationOptionsFromMutationLog, SqliteError } from './adapter-types.js'
import { getExecArgsFromMutation } from './mutation.js'
import type { LiveStoreSchema, MutationLogMetaRow } from './schema/index.js'
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
  logDb: InMemoryDatabase
  db: InMemoryDatabase
  schema: LiveStoreSchema
  migrationOptions: MigrationOptionsFromMutationLog
  onProgress: (_: { done: number; total: number }) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const mutationsCount = logDb
      .prepare(`SELECT COUNT(*) AS count FROM ${MUTATION_LOG_META_TABLE}`)
      .select<{ count: number }>(undefined)[0]!.count

    const processMutation = (row: MutationLogMetaRow) =>
      Effect.gen(function* () {
        const mutationDef = schema.mutations.get(row.mutation) ?? shouldNeverHappen(`Unknown mutation ${row.mutation}`)

        if (migrationOptions.excludeMutations?.has(row.mutation) === true) return

        if (Schema.hash(mutationDef.schema) !== row.schemaHash) {
          console.warn(`Schema hash mismatch for mutation ${row.mutation}. Trying to apply mutation anyway.`)
        }

        const argsDecodedEither = Schema.decodeUnknownEither(Schema.parseJson(mutationDef.schema))(row.argsJson)
        if (argsDecodedEither._tag === 'Left') {
          return shouldNeverHappen(`\
There was an error decoding the persisted mutation event args for mutation "${row.mutation}".
This likely means the schema has changed in an incompatible way.

Error: ${argsDecodedEither.left}
        `)
        }

        const mutationEventDecoded = {
          id: row.id,
          mutation: row.mutation,
          args: argsDecodedEither.right,
        }
        // const argsEncoded = JSON.parse(row.args_json)
        // const mutationSqlRes =
        //   typeof mutation.sql === 'string'
        //     ? mutation.sql
        //     : mutation.sql(Schema.decodeUnknownSync(mutation.schema)(argsEncoded))
        // const mutationSql = typeof mutationSqlRes === 'string' ? mutationSqlRes : mutationSqlRes.sql
        // const bindValues = typeof mutationSqlRes === 'string' ? argsEncoded : mutationSqlRes.bindValues

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        for (const { statementSql, bindValues } of execArgsArr) {
          try {
            // TODO cache prepared statements for mutations
            const getRowsChanged = db.execute(statementSql, bindValues)
            if (
              import.meta.env.DEV &&
              getRowsChanged() === 0 &&
              migrationOptions.logging?.excludeAffectedRows?.(statementSql) !== true
            ) {
              console.warn(`Mutation "${mutationDef.name}" did not affect any rows:`, statementSql, bindValues)
            }
            // console.log(`Re-executed mutation ${mutationSql}`, bindValues)
          } catch (e) {
            yield* new SqliteError({
              sql: statementSql,
              bindValues,
              code: (e as any).resultCode,
              cause: e,
            })
          }
        }
      }).pipe(Effect.withSpan(`@livestore/common:rehydrateFromMutationLog:processMutation`))

    const CHUNK_SIZE = 100

    const stmt = logDb.prepare(sql`\
SELECT * FROM ${MUTATION_LOG_META_TABLE} 
WHERE id > COALESCE($id, '') 
ORDER BY id ASC
LIMIT ${CHUNK_SIZE}
`)

    let processedMutations = 0

    yield* Stream.unfoldChunk<Chunk.Chunk<MutationLogMetaRow> | { _tag: 'Initial ' }, MutationLogMetaRow>(
      { _tag: 'Initial ' },
      (item) => {
        // End stream if no more rows
        if (Chunk.isChunk(item) && item.length === 0) return Option.none()

        const lastId = Chunk.isChunk(item) ? Chunk.last(item).pipe(Option.getOrUndefined)?.id : undefined
        const nextItem = Chunk.fromIterable(
          stmt.select<MutationLogMetaRow>({ $id: lastId } as any as PreparedBindValues),
        )
        const prevItem = Chunk.isChunk(item) ? item : Chunk.empty()
        return Option.some([prevItem, nextItem])
      },
    ).pipe(
      (_) => _,
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
