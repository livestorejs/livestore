import type { Stream, SubscriptionRef, TRef } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { LiveStoreSchema, MutationEvent } from './schema/index.js'
import type { PreparedBindValues } from './util.js'

export interface PreparedStatement {
  execute(bindValues: PreparedBindValues | undefined): GetRowsChangedCount
  select<T>(bindValues: PreparedBindValues | undefined): ReadonlyArray<T>
  finalize(): void
}

export type StoreAdapter = {
  /** Main thread database (usually in-memory) */
  mainDb: InMemoryDatabase
  /** The coordinator is responsible for persisting the database, syncing etc */
  coordinator: Coordinator
}

export type InMemoryDatabase = {
  _tag: 'InMemoryDatabase'
  prepare(queryStr: string): PreparedStatement
  execute(queryStr: string, bindValues: PreparedBindValues | undefined): GetRowsChangedCount
  dangerouslyReset(): Promise<void>
  export(): Uint8Array
}

export type ResetMode = 'all-data' | 'only-app-db'

export type NetworkStatus = {
  isConnected: boolean
  timestampMs: number
}

export type Coordinator = {
  hasLock: TRef.TRef<boolean>
  syncMutations: Stream.Stream<MutationEvent.AnyEncoded>
  execute(queryStr: string, bindValues: PreparedBindValues | undefined, span: otel.Span | undefined): Promise<void>
  mutate(mutationEventEncoded: MutationEvent.Any, options: { span: otel.Span; persisted: boolean }): Promise<void>
  dangerouslyReset(mode: ResetMode): Promise<void>
  export(span: otel.Span | undefined): Promise<Uint8Array | undefined>
  /**
   * This is different from `export` since in `getInitialSnapshot` is usually the place for migrations etc to happen
   */
  getInitialSnapshot(): Promise<Uint8Array>
  getMutationLogData(): Promise<Uint8Array>
  shutdown(): Promise<void>
  networkStatus: SubscriptionRef.SubscriptionRef<NetworkStatus>
}

export type GetRowsChangedCount = () => number

export type BootDb = {
  _tag: 'BootDb'
  execute(queryStr: string, bindValues?: PreparedBindValues): void
  mutate: <const TMutationArg extends ReadonlyArray<MutationEvent.Any>>(...list: TMutationArg) => void
  select<T>(queryStr: string, bindValues?: PreparedBindValues): ReadonlyArray<T>
  txn(callback: () => void): void
}

// TODO possibly allow a combination of these options
// TODO allow a way to stream the migration progress back to the app
export type MigrationOptions<TSchema extends LiveStoreSchema = LiveStoreSchema> =
  | MigrationOptionsFromMutationLog<TSchema>
  | {
      strategy: 'hard-reset'
      hooks?: Partial<MigrationHooks>
    }
  | {
      strategy: 'manual'
      migrate: (oldDb: Uint8Array) => Promise<Uint8Array> | Uint8Array
      hooks?: Partial<MigrationHooks>
    }

export type MigrationHooks = {
  /** Runs on the empty in-memory database with no database schemas applied yet */
  init: MigrationHook
  /** Runs before applying the migration strategy but after table schemas have been applied and singleton rows have been created */
  pre: MigrationHook
  /** Runs after applying the migration strategy before creating export snapshot and closing the database */
  post: MigrationHook
}

export type MigrationHook = (db: InMemoryDatabase) => void | Promise<void>

export type MigrationOptionsFromMutationLog<TSchema extends LiveStoreSchema = LiveStoreSchema> = {
  strategy: 'from-mutation-log'
  /**
   * Mutations to exclude in the mutation log
   *
   * @default new Set(['livestore.RawSql'])
   */
  excludeMutations?: ReadonlySet<keyof TSchema['_MutationDefMapType'] & string>
  hooks?: Partial<MigrationHooks>
  logging?: {
    excludeAffectedRows?: (sqlStmt: string) => boolean
  }
}

export type StoreAdapterFactory = (opts: {
  otelTracer: otel.Tracer
  otelContext: otel.Context
  schema: LiveStoreSchema
}) => StoreAdapter | Promise<StoreAdapter>
