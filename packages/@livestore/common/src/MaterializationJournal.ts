import { Context, Effect, Layer, Predicate, ReadonlyArray, Schema } from '@livestore/utils/effect'

import { SqliteError, type SqliteDb } from './adapter-types.ts'
import { execSql, execSqlPrepared } from './leader-thread/connection.ts'
import * as EventSequenceNumber from './schema/EventSequenceNumber/mod.ts'
import { SystemTables } from './schema/mod.ts'
import { findManyRows, insertRow } from './sql-queries/index.ts'
import * as SqliteDbHelper from './sqlite-db-helper.ts'
import { prepareBindValues, sql } from './util.ts'

export const TypeId = '~@livestore/common/MaterializationJournal' as const
export type TypeId = typeof TypeId

export const MaterializationJournalErrorTypeId = '~@livestore/common/MaterializationJournalError' as const

export const isMaterializationJournalError = (u: unknown): u is MaterializationJournalError =>
  Predicate.hasProperty(u, MaterializationJournalErrorTypeId)

export class MaterializationJournalError extends Schema.TaggedErrorClass<MaterializationJournalError>(
  MaterializationJournalErrorTypeId,
)('MaterializationJournalError', {
  method: Schema.Literals(['record', 'rollback', 'discardUpTo']),
  cause: Schema.Defect(),
}) {
  readonly [MaterializationJournalErrorTypeId] = MaterializationJournalErrorTypeId
}

export type MaterializationChangeset = { _tag: 'changeset'; data: Uint8Array<ArrayBuffer> } | { _tag: 'no-op' }

export type MaterializationRecord = {
  key: EventSequenceNumber.Client.Composite
  changeset: MaterializationChangeset
}

export interface Service {
  readonly [TypeId]: TypeId
  /** Stores a materialization record, replacing any record at the same key. */
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

interface Options {
  readonly dbState: SqliteDb
}

export const make = ({ dbState }: Options) => {
  const deleteByKeys = Effect.fnUntraced(function* (keys: ReadonlyArray<EventSequenceNumber.Client.Composite>) {
    // Keep DELETE statements below SQLite's bound-parameter limit.
    const keyChunks = ReadonlyArray.chunksOf(100)(keys)

    for (const keyChunk of keyChunks) {
      const placeholders = keyChunk.map(() => '(?, ?, ?)').join(', ')
      const bindValues = keyChunk.flatMap((key) => [key.global, key.client, key.rebaseGeneration])
      const statement = sql`DELETE FROM ${SystemTables.MATERIALIZATION_JOURNAL_META_TABLE}
                            WHERE (seqNumGlobal, seqNumClient, seqNumRebaseGeneration) IN (${placeholders})`

      yield* execSqlPrepared(dbState, statement, prepareBindValues(bindValues, statement))
    }
  }, SqliteDbHelper.withSavepoint(dbState))

  return MaterializationJournal.of({
    [TypeId]: TypeId,
    record: Effect.fnUntraced(
      function* (record: MaterializationRecord) {
        yield* deleteByKeys([record.key])

        // Generate the parameterized INSERT statement
        const [statement, bindValues] = insertRow({
          tableName: SystemTables.MATERIALIZATION_JOURNAL_META_TABLE,
          columns: SystemTables.materializationJournalMetaTable.sqliteDef.columns,
          values: {
            seqNumGlobal: record.key.global,
            seqNumClient: record.key.client,
            seqNumRebaseGeneration: record.key.rebaseGeneration,
            changeset: record.changeset._tag === 'changeset' ? record.changeset.data : null,
            // Legacy processors still expose this column for development diagnostics.
            debug: null,
          },
        })

        yield* execSqlPrepared(dbState, statement, prepareBindValues(bindValues, statement))
      },
      SqliteDbHelper.withSavepoint(dbState),
      Effect.mapError((cause) => new MaterializationJournalError({ method: 'record', cause })),
    ),
    rollback: Effect.fnUntraced(
      function* (keys: ReadonlyArray<EventSequenceNumber.Client.Composite>) {
        const sortedKeys = keys.toSorted((a, b) => EventSequenceNumber.Client.compare(b, a))
        const rollbackRecords = yield* Effect.forEach(
          sortedKeys,
          Effect.fnUntraced(function* (key) {
            const [statement, bindValues] = findManyRows({
              tableName: SystemTables.MATERIALIZATION_JOURNAL_META_TABLE,
              columns: SystemTables.materializationJournalMetaTable.sqliteDef.columns,
              where: {
                seqNumGlobal: key.global,
                seqNumClient: key.client,
                seqNumRebaseGeneration: key.rebaseGeneration,
              },
              limit: 1,
            })
            const preparedBindValues = prepareBindValues(bindValues, statement)
            const row = yield* Effect.try({
              try: () => dbState.select<SystemTables.MaterializationJournalMetaRow>(statement, preparedBindValues)[0],
              catch: (cause) => new SqliteError({ cause, query: { sql: statement, bindValues: preparedBindValues } }),
            })

            if (row === undefined) {
              return yield* new MaterializationJournalError({
                method: 'rollback',
                cause: new Error(
                  `Missing materialization journal record for ${EventSequenceNumber.Client.toString(key)}`,
                ),
              })
            }

            return {
              key,
              changeset:
                row.changeset === null
                  ? { _tag: 'no-op' as const }
                  : { _tag: 'changeset' as const, data: row.changeset },
            }
          }),
        )

        for (const record of rollbackRecords) {
          if (record.changeset._tag === 'changeset') {
            const data = record.changeset.data
            yield* Effect.try({
              try: () => dbState.makeChangeset(data).invert().apply(),
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
}

export const layer = (options: Options) => Layer.succeed(MaterializationJournal, make(options))

export const layerTest = Layer.succeed(
  MaterializationJournal,
  MaterializationJournal.of({
    [TypeId]: TypeId,
    record: () => Effect.void,
    rollback: () => Effect.void,
    discardUpTo: () => Effect.void,
  }),
)
