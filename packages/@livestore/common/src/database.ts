import type * as otel from '@opentelemetry/api'

import type { LiveStoreSchema, MutationEvent } from './schema/index.js'
import type { ParamsObject, PreparedBindValues } from './util.js'

export interface PreparedStatement {
  execute(bindValues: PreparedBindValues | undefined): GetRowsChangedCount
  select<T>(bindValues: PreparedBindValues | undefined): ReadonlyArray<T>
  finalize(): void
}

export type DatabaseImpl = {
  mainDb: MainDatabase
  storageDb: StorageDatabase
}

export type MainDatabase = {
  prepare(queryStr: string): PreparedStatement
  execute(queryStr: string, bindValues: PreparedBindValues | undefined): GetRowsChangedCount
  dangerouslyReset(): Promise<void>
  export(): Uint8Array
}

export type StorageDatabase = {
  execute(queryStr: string, bindValues: PreparedBindValues | undefined, span: otel.Span | undefined): Promise<void>
  mutate(mutationEventEncoded: MutationEvent.Any, span: otel.Span): Promise<void>
  dangerouslyReset(): Promise<void>
  export(span: otel.Span | undefined): Promise<Uint8Array | undefined>
  /**
   * This is different from `export` since in `getInitialSnapshot` is usually the place for migrations etc to happen
   */
  getInitialSnapshot(): Promise<Uint8Array>
  getMutationLogData(): Promise<Uint8Array>
  shutdown(): Promise<void>
}

export type GetRowsChangedCount = () => number

export type BootDb = {
  execute(queryStr: string, bindValues?: ParamsObject): void
  mutate: <const TMutationArg extends ReadonlyArray<MutationEvent.Any>>(...list: TMutationArg) => void
  select<T>(queryStr: string, bindValues?: ParamsObject): ReadonlyArray<T>
  txn(callback: () => void): void
}

// TODO possibly allow a combination of these options
export type MigrationOptions<TSchema extends LiveStoreSchema = LiveStoreSchema> =
  | MigrationOptionsFromMutationLog<TSchema>
  | {
      strategy: 'hard-reset'
    }
  | {
      strategy: 'manual'
      migrate: (oldDb: Uint8Array) => Promise<Uint8Array> | Uint8Array
    }

export type MigrationOptionsFromMutationLog<TSchema extends LiveStoreSchema = LiveStoreSchema> = {
  strategy: 'from-mutation-log'
  /**
   * Mutations to exclude in the mutation log
   *
   * @default new Set(['livestore.RawSql'])
   */
  excludeMutations?: ReadonlySet<keyof TSchema['_MutationDefMapType'] & string>
  postHook?: (db: MainDatabase) => void | Promise<void>
  logging?: {
    excludeAffectedRows?: (sqlStmt: string) => boolean
  }
}

export type DatabaseFactory = (opts: {
  otelTracer: otel.Tracer
  otelContext: otel.Context
  schema: LiveStoreSchema
}) => DatabaseImpl | Promise<DatabaseImpl>
