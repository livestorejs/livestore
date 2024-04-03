import type * as otel from '@opentelemetry/api'

import type { LiveStoreSchema, MutationEvent } from './schema/index.js'
import type { PreparedBindValues } from './util.js'

export interface PreparedStatement {
  execute(bindValues: PreparedBindValues | undefined): void
  select<T>(bindValues: PreparedBindValues | undefined): ReadonlyArray<T>
  finalize(): void
}

export type DatabaseImpl = {
  mainDb: MainDatabase
  storageDb: StorageDatabase
}

export type MainDatabase = {
  prepare(queryStr: string): PreparedStatement
  execute(queryStr: string, bindValues: PreparedBindValues | undefined): void
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

// TODO possibly allow a combination of these options
export type MigrationOptions<TSchema extends LiveStoreSchema = LiveStoreSchema> =
  | {
      strategy: 'from-mutation-log'
      /**
       * Mutations to exclude in the mutation log
       *
       * @default new Set(['livestore.RawSql'])
       */
      excludeMutations?: ReadonlySet<keyof TSchema['_MutationDefMapType'] & string>
    }
  | {
      strategy: 'hard-reset'
    }
  | {
      strategy: 'manual'
      migrate: (oldDb: Uint8Array) => Promise<Uint8Array> | Uint8Array
    }

export type DatabaseFactory = (opts: {
  otelTracer: otel.Tracer
  otelContext: otel.Context
  schema: LiveStoreSchema
}) => DatabaseImpl | Promise<DatabaseImpl>
