import { type Effect, Schema } from '@livestore/utils/effect'
import type { SqliteError, UnknownError } from './errors.ts'
import type { EventSequenceNumber } from './schema/mod.ts'
import type { QueryBuilder } from './schema/state/sqlite/query-builder/api.ts'
import type { PreparedBindValues } from './util.ts'

/**
 * Common interface for SQLite databases used by LiveStore to facilitate a consistent API across different platforms.
 * Always assumes a synchronous SQLite build with the `bytecode` and `session` extensions enabled.
 * Can be either in-memory or persisted to disk.
 */
export interface SqliteDb<TReq = any, TMetadata extends TReq = TReq> {
  _tag: 'SqliteDb'
  metadata: TMetadata
  /** Debug information (currently not persisted and only available at runtime) */
  debug: SqliteDebugInfo
  prepare(queryStr: string): PreparedStatement
  execute(
    queryStr: string,
    bindValues?: PreparedBindValues | undefined,
    options?: { onRowsChanged?: (rowsChanged: number) => void },
  ): void
  execute(queryBuilder: QueryBuilder.Any, options?: { onRowsChanged?: (rowsChanged: number) => void }): void

  select<T>(queryStr: string, bindValues?: PreparedBindValues | undefined): ReadonlyArray<T>
  select<T>(queryBuilder: QueryBuilder<T, any, any>): T

  export(): Uint8Array<ArrayBuffer>
  import: (data: Uint8Array<ArrayBuffer> | SqliteDb<TReq>) => void
  close(): void
  destroy(): void
  session(): SqliteDbSession
  makeChangeset: (data: Uint8Array<ArrayBuffer>) => SqliteDbChangeset
}

export type SqliteDebugInfo = { head: EventSequenceNumber.EventSequenceNumber }

// TODO refactor this helper type. It's quite cumbersome to use and should be revisited.
export type MakeSqliteDb<
  TReq = { dbPointer: number; persistenceInfo: PersistenceInfo },
  TInput_ extends { _tag: string } = { _tag: string },
  TMetadata_ extends TReq = TReq,
  R = never,
> = <
  TInput extends TInput_,
  TMetadata extends TMetadata_ & { _tag: TInput['_tag'] } = TMetadata_ & { _tag: TInput['_tag'] },
>(
  input: TInput,
) => Effect.Effect<SqliteDb<TReq, Extract<TMetadata, { _tag: TInput['_tag'] }>>, SqliteError | UnknownError, R>

export interface PreparedStatement {
  execute(bindValues: PreparedBindValues | undefined, options?: { onRowsChanged?: (rowsChanged: number) => void }): void
  select<T>(bindValues: PreparedBindValues | undefined): ReadonlyArray<T>
  finalize(): void
  sql: string
}

export type SqliteDbSession = {
  changeset: () => Uint8Array<ArrayBuffer> | undefined
  finish: () => void
}

export type SqliteDbChangeset = {
  // TODO combining changesets (requires changes in the SQLite WASM binding)
  invert: () => SqliteDbChangeset
  apply: () => void
}

export const PersistenceInfo = Schema.Struct(
  {
    fileName: Schema.String,
  },
  { key: Schema.String, value: Schema.Any },
).annotations({ title: 'LiveStore.PersistenceInfo' })

export type PersistenceInfo<With extends {} = {}> = typeof PersistenceInfo.Type & With
