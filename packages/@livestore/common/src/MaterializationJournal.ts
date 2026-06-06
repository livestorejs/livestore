import { Context, Effect, Layer, Option } from '@livestore/utils/effect'

import type { SqliteDb } from './adapter-types.ts'
import * as EventSequenceNumber from './schema/EventSequenceNumber/mod.ts'
import { SystemTables } from './schema/mod.ts'
import { findManyRows, insertRow } from './sql-queries/index.ts'
import { prepareBindValues, sql } from './util.ts'

export const TypeId = '~@livestore/common/MaterializationJournal' as const
export type TypeId = typeof TypeId

export type MaterializationKey = EventSequenceNumber.Client.Composite

export const MaterializationKey = {
  fromEvent: (event: { seqNum: EventSequenceNumber.Client.Composite }): MaterializationKey => event.seqNum,
  toString: (key: MaterializationKey): string => `${key.global}:${key.client}:${key.rebaseGeneration}`,
  compare: EventSequenceNumber.Client.compare,
}

export type MaterializationChangeset =
  | { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug?: unknown }
  | { _tag: 'no-op' }

export type MaterializationRecord = {
  key: MaterializationKey
  sessionChangeset: MaterializationChangeset
}

export interface MaterializationJournalService {
  readonly [TypeId]: TypeId
  record: (record: MaterializationRecord) => Effect.Effect<void>
  get: (key: MaterializationKey) => Effect.Effect<Option.Option<MaterializationRecord>>
  rollback: (keys: ReadonlyArray<MaterializationKey>) => Effect.Effect<void>
  remove: (keys: ReadonlyArray<MaterializationKey>) => Effect.Effect<void>
  /** Removes all records whose key is less than or equal to `key`, but ignoring rebase generation. */
  removeThrough: (key: MaterializationKey) => Effect.Effect<void>
}

export class MaterializationJournal extends Context.Tag('@livestore/common/MaterializationJournal')<
  MaterializationJournal,
  MaterializationJournalService
>() {}

export const make = ({ dbState }: { dbState: SqliteDb }) => {
  const getRecord = (key: MaterializationKey): Option.Option<MaterializationRecord> => {
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

    const row = dbState.select<SystemTables.MaterializationJournalMetaRow>(
      statement,
      prepareBindValues(bindValues, statement),
    )[0]

    return Option.fromNullable(row).pipe(
      Option.map((_) => ({
        key,
        sessionChangeset:
          _.changeset === null
            ? { _tag: 'no-op' as const }
            : { _tag: 'sessionChangeset' as const, data: _.changeset, debug: _.debug },
      })),
    )
  }

  const remove = (keys: ReadonlyArray<MaterializationKey>) =>
    Effect.sync(() => {
      const keyChunks = chunkKeys(keys)
      for (const keyChunk of keyChunks) {
        dbState.execute(
          sql`DELETE FROM ${SystemTables.MATERIALIZATION_JOURNAL_META_TABLE} WHERE (seqNumGlobal, seqNumClient, seqNumRebaseGeneration) IN (${keyChunk.join(', ')})`,
        )
      }
    })

  return MaterializationJournal.of({
    [TypeId]: TypeId,
    record: Effect.fnUntraced(function* (record) {
      yield* remove([record.key])
      yield* Effect.sync(() => {
        const [statement, bindValues] = insertRow({
          tableName: SystemTables.MATERIALIZATION_JOURNAL_META_TABLE,
          columns: SystemTables.materializationJournalMetaTable.sqliteDef.columns,
          values: {
            seqNumGlobal: record.key.global,
            seqNumClient: record.key.client,
            seqNumRebaseGeneration: record.key.rebaseGeneration,
            changeset: record.sessionChangeset._tag === 'sessionChangeset' ? record.sessionChangeset.data : null,
            debug: record.sessionChangeset._tag === 'sessionChangeset' ? (record.sessionChangeset.debug ?? null) : null,
          },
        })

        dbState.execute(statement, prepareBindValues(bindValues, statement))
      })
    }),
    get: (key) => Effect.sync(() => getRecord(key)),
    rollback: Effect.fnUntraced(function* (keys) {
      const sortedKeys = sortRollbackKeys(keys)
      const rollbackRecords = sortedKeys.map((key) => {
        const record = getRecord(key)
        if (record._tag === 'None') return undefined
        return record.value
      })

      const missingKey = sortedKeys[rollbackRecords.indexOf(undefined)]
      if (missingKey !== undefined) {
        return yield* Effect.dieMessage(
          `Missing materialization journal record for ${MaterializationKey.toString(missingKey)}`,
        )
      }

      for (const record of rollbackRecords as MaterializationRecord[]) {
        if (record.sessionChangeset._tag === 'sessionChangeset') {
          dbState.makeChangeset(record.sessionChangeset.data).invert().apply()
        }
      }

      yield* remove(sortedKeys)
    }),
    remove,
    removeThrough: (key) =>
      Effect.sync(() => {
        dbState.execute(sql`DELETE FROM ${SystemTables.MATERIALIZATION_JOURNAL_META_TABLE}
          WHERE seqNumGlobal < ${key.global}
            OR (
              seqNumGlobal = ${key.global}
              AND seqNumClient <= ${key.client}
            )`)
      }),
  })
}

export const layer = (options: { dbState: SqliteDb }) => Layer.succeed(MaterializationJournal, make(options))

export const makeMemory = ({ rollback }: { rollback: (changeset: Uint8Array<ArrayBuffer>) => void }) => {
  const records = new Map<string, MaterializationRecord>()

  const remove = (keys: ReadonlyArray<MaterializationKey>) =>
    Effect.sync(() => {
      for (const key of keys) {
        records.delete(MaterializationKey.toString(key))
      }
    })

  return MaterializationJournal.of({
    [TypeId]: TypeId,
    record: (record) =>
      Effect.sync(() => {
        records.set(MaterializationKey.toString(record.key), record)
      }),
    get: (key) => Effect.sync(() => Option.fromNullable(records.get(MaterializationKey.toString(key)))),
    rollback: Effect.fnUntraced(function* (keys) {
      const sortedKeys = sortRollbackKeys(keys)
      const rollbackRecords = sortedKeys.map((key) => {
        const record = records.get(MaterializationKey.toString(key))
        if (record === undefined) {
          return undefined
        }
        return record
      })

      const missingKey = sortedKeys[rollbackRecords.indexOf(undefined)]
      if (missingKey !== undefined) {
        return yield* Effect.dieMessage(
          `Missing materialization journal record for ${MaterializationKey.toString(missingKey)}`,
        )
      }

      for (const record of rollbackRecords as MaterializationRecord[]) {
        if (record.sessionChangeset._tag === 'sessionChangeset') {
          rollback(record.sessionChangeset.data)
        }
      }

      yield* remove(sortedKeys)
    }),
    remove,
    removeThrough: (key) =>
      Effect.sync(() => {
        for (const record of records.values()) {
          if (record.key.global < key.global || (record.key.global === key.global && record.key.client <= key.client)) {
            records.delete(MaterializationKey.toString(record.key))
          }
        }
      }),
  })
}

export const layerMemory = (options: { rollback: (changeset: Uint8Array<ArrayBuffer>) => void }) =>
  Layer.succeed(MaterializationJournal, makeMemory(options))

const sortRollbackKeys = (keys: ReadonlyArray<MaterializationKey>) =>
  [...keys].toSorted((a, b) => EventSequenceNumber.Client.compare(b, a))

const chunkKeys = (keys: ReadonlyArray<MaterializationKey>) => {
  const chunks: string[][] = []
  for (let i = 0; i < keys.length; i += 100) {
    chunks.push(keys.slice(i, i + 100).map((key) => `(${key.global}, ${key.client}, ${key.rebaseGeneration})`))
  }
  return chunks
}
