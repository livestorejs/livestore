import { Context, Effect, Layer, Predicate, ReadonlyArray, Schema } from '@livestore/utils/effect'

import { SqliteError } from './adapter-types.ts'
import { execSql, execSqlPrepared } from './leader-thread/connection.ts'
import * as EventSequenceNumber from './schema/EventSequenceNumber/mod.ts'
import { SystemTables } from './schema/mod.ts'
import { insertRowPrepared } from './sql-queries/index.ts'
import * as SqliteDbHelper from './sqlite-db-helper.ts'
import * as StateSqliteDb from './StateSqliteDb.ts'
import { prepareBindValues, sql } from './util.ts'

export const TypeId = '~@livestore/common/MaterializationJournal' as const
export type TypeId = typeof TypeId

export const MaterializationJournalErrorTypeId = '~@livestore/common/MaterializationJournalError' as const

export const isMaterializationJournalError = (u: unknown): u is MaterializationJournalError =>
  Predicate.hasProperty(u, MaterializationJournalErrorTypeId)

export class MaterializationJournalError extends Schema.TaggedError<MaterializationJournalError>(
  MaterializationJournalErrorTypeId,
)('MaterializationJournalError', {
  method: Schema.Literals(['record', 'rollback', 'discardUpTo']),
  cause: Schema.Defect(),
}) {
  readonly [MaterializationJournalErrorTypeId] = MaterializationJournalErrorTypeId
}

export type MaterializationRecord = {
  key: EventSequenceNumber.Client.Composite
  /** Changes recorded while materializing the event, or `null` when materialization did not change state. */
  changeset: Uint8Array<ArrayBuffer> | null
}

export interface Service {
  readonly [TypeId]: TypeId
  /**
   * Stores a materialization record, replacing any record at the same key. Runs inside the caller's savepoint or
   * transaction, which every materialization already opens, so the replacement is atomic with the materialization.
   */
  record: (record: MaterializationRecord) => Effect.Effect<void, MaterializationJournalError>
  /** Reverts the keyed materializations in reverse order, then discards their records. */
  rollback: (
    keys: ReadonlyArray<EventSequenceNumber.Client.Composite>,
  ) => Effect.Effect<void, MaterializationJournalError>
  /** Discards records whose key is less than or equal to `key`, ignoring rebase generation. */
  discardUpTo: (key: EventSequenceNumber.Client.Composite) => Effect.Effect<void, MaterializationJournalError>
}

export class MaterializationJournal extends Context.Service<MaterializationJournal, Service>()(
  '@livestore/common/MaterializationJournal',
) {}

export const make = Effect.gen(function* () {
  const dbState = yield* StateSqliteDb.StateSqliteDb

  /** Runs inside `rollback`'s savepoint, which keeps a multi-chunk delete atomic. */
  const deleteByKeys = Effect.fnUntraced(function* (keys: ReadonlyArray<EventSequenceNumber.Client.Composite>) {
    for (const keyChunk of chunkKeys(keys)) {
      const placeholders = keyChunk.map(() => '(?, ?, ?)').join(', ')
      const bindValues = keyChunk.flatMap((key) => [key.global, key.client, key.rebaseGeneration])
      const statement = sql`DELETE FROM ${SystemTables.MATERIALIZATION_JOURNAL_META_TABLE}
                            WHERE (seqNumGlobal, seqNumClient, seqNumRebaseGeneration) IN (${placeholders})`

      yield* execSqlPrepared(dbState, statement, prepareBindValues(bindValues, statement))
    }
  })

  /** Reads the records of `keys`, chunked like `deleteByKeys`. */
  const selectChangesets = Effect.fnUntraced(function* (keys: ReadonlyArray<EventSequenceNumber.Client.Composite>) {
    const changesets = new Map<string, Uint8Array<ArrayBuffer> | null>()
    for (const keyChunk of chunkKeys(keys)) {
      const placeholders = keyChunk.map(() => '(?, ?, ?)').join(', ')
      const bindValues = keyChunk.flatMap((key) => [key.global, key.client, key.rebaseGeneration])
      const statement = sql`SELECT seqNumGlobal, seqNumClient, seqNumRebaseGeneration, changeset
                            FROM ${SystemTables.MATERIALIZATION_JOURNAL_META_TABLE}
                            WHERE (seqNumGlobal, seqNumClient, seqNumRebaseGeneration) IN (${placeholders})`
      const preparedBindValues = prepareBindValues(bindValues, statement)
      const rows = yield* Effect.try({
        try: () => dbState.select<SystemTables.MaterializationJournalMetaRow>(statement, preparedBindValues),
        catch: (cause) => new SqliteError({ cause, query: { sql: statement, bindValues: preparedBindValues } }),
      })
      for (const row of rows) {
        changesets.set(
          journalKey({
            global: row.seqNumGlobal,
            client: row.seqNumClient,
            rebaseGeneration: row.seqNumRebaseGeneration,
          }),
          row.changeset,
        )
      }
    }
    return changesets
  })

  // `record` runs for every materialized event, including every event a rebase replays, so its statements are built
  // once and run without a span each. The materialization that records them carries the trace.
  const insertStatement = insertRowPrepared({
    tableName: SystemTables.MATERIALIZATION_JOURNAL_META_TABLE,
    columns: SystemTables.materializationJournalMetaTable.sqliteDef.columns,
  })
  const deleteRecordStatement = sql`DELETE FROM ${SystemTables.MATERIALIZATION_JOURNAL_META_TABLE}
    WHERE seqNumGlobal = $seqNumGlobal AND seqNumClient = $seqNumClient AND seqNumRebaseGeneration = $seqNumRebaseGeneration`

  return MaterializationJournal.of({
    [TypeId]: TypeId,
    record: (record) =>
      Effect.try({
        try: () => {
          const bindValues = {
            seqNumGlobal: record.key.global,
            seqNumClient: record.key.client,
            seqNumRebaseGeneration: record.key.rebaseGeneration,
            changeset: record.changeset,
          }
          for (const statement of [deleteRecordStatement, insertStatement]) {
            const preparedBindValues = prepareBindValues(bindValues, statement)
            try {
              dbState.execute(statement, preparedBindValues)
            } catch (cause) {
              throw new SqliteError({ cause, query: { sql: statement, bindValues: preparedBindValues } })
            }
          }
        },
        catch: (cause) => new MaterializationJournalError({ method: 'record', cause }),
      }),
    rollback: Effect.fnUntraced(
      function* (keys: ReadonlyArray<EventSequenceNumber.Client.Composite>) {
        const sortedKeys = keys.toSorted((a, b) => EventSequenceNumber.Client.compare(b, a))
        const changesetsByKey = yield* selectChangesets(sortedKeys)
        const rollbackChangesets: Array<Uint8Array<ArrayBuffer> | null> = []
        for (const key of sortedKeys) {
          const changeset = changesetsByKey.get(journalKey(key))
          if (changeset === undefined) {
            return yield* new MaterializationJournalError({
              method: 'rollback',
              cause: new Error(
                `Missing materialization journal record for ${EventSequenceNumber.Client.toString(key)}`,
              ),
            })
          }
          rollbackChangesets.push(changeset)
        }

        for (const changeset of rollbackChangesets) {
          if (changeset !== null) {
            yield* Effect.try({
              try: () => dbState.makeChangeset(changeset).invert().apply(),
              catch: (cause) => new SqliteError({ cause }),
            })
          }
        }

        yield* deleteByKeys(sortedKeys)
      },
      SqliteDbHelper.withSavepoint(dbState),
      Effect.mapError((cause) =>
        isMaterializationJournalError(cause) === true
          ? cause
          : new MaterializationJournalError({ method: 'rollback', cause }),
      ),
    ),
    discardUpTo: Effect.fnUntraced(
      function* (key: EventSequenceNumber.Client.Composite) {
        yield* execSql(
          dbState,
          sql`DELETE FROM ${SystemTables.MATERIALIZATION_JOURNAL_META_TABLE}
              WHERE seqNumGlobal < ${key.global}
                 OR (
                  seqNumGlobal = ${key.global}
                      AND seqNumClient <= ${key.client}
                  )`,
          {},
        )
      },
      SqliteDbHelper.withSavepoint(dbState),
      Effect.mapError((cause) => new MaterializationJournalError({ method: 'discardUpTo', cause })),
    ),
  })
})

export const layer = Layer.effect(MaterializationJournal, make)

export const layerTest = Layer.succeed(
  MaterializationJournal,
  MaterializationJournal.of({
    [TypeId]: TypeId,
    record: () => Effect.void,
    rollback: () => Effect.void,
    discardUpTo: () => Effect.void,
  }),
)

const journalKey = (key: { global: number; client: number; rebaseGeneration: number }) =>
  `${key.global},${key.client},${key.rebaseGeneration}`

/** Keys per statement: three bound parameters each, well below SQLite's limit of 999. */
const KEY_CHUNK_SIZE = 100

/**
 * Splits keys into chunks of exactly KEY_CHUNK_SIZE, padding the last chunk by repeating its final key. Every
 * statement then has the same SQL, so the connection prepares and caches one statement instead of one per chunk
 * length. A repeated key in an `IN` list matches the same row and changes no result.
 */
const chunkKeys = (
  keys: ReadonlyArray<EventSequenceNumber.Client.Composite>,
): ReadonlyArray<ReadonlyArray<EventSequenceNumber.Client.Composite>> =>
  ReadonlyArray.chunksOf(KEY_CHUNK_SIZE)(keys).map((chunk) =>
    chunk.length === KEY_CHUNK_SIZE
      ? chunk
      : [...chunk, ...Array.from({ length: KEY_CHUNK_SIZE - chunk.length }, () => chunk.at(-1)!)],
  )
