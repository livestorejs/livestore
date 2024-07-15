import type { Effect, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'

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
  export(): Uint8Array
}

export type ResetMode = 'all-data' | 'only-app-db'

export const NetworkStatus = Schema.Struct({
  isConnected: Schema.Boolean,
  timestampMs: Schema.Number,
})

export type NetworkStatus = {
  isConnected: boolean
  timestampMs: number
}

export const BootStateProgress = Schema.Struct({
  done: Schema.Number,
  total: Schema.Number,
})

export const BootStatus = Schema.Union(
  Schema.Struct({ stage: Schema.Literal('loading') }),
  Schema.Struct({ stage: Schema.Literal('migrating'), progress: BootStateProgress }),
  Schema.Struct({ stage: Schema.Literal('rehydrating'), progress: BootStateProgress }),
  Schema.Struct({ stage: Schema.Literal('syncing'), progress: BootStateProgress }),
  Schema.Struct({ stage: Schema.Literal('done') }),
)

export type BootStatus = typeof BootStatus.Type

export type Coordinator = {
  isShutdownRef: { current: boolean }
  devtools: {
    enabled: boolean
    channelId: string
    connect: (options: { port: MessagePort; connectionId: string }) => Effect.Effect<void, UnexpectedError>
  }
  // TODO is exposing the lock status really needed (or only relevant for web adapter?)
  lockStatus: SubscriptionRef.SubscriptionRef<LockStatus>
  syncMutations: Stream.Stream<MutationEvent.AnyEncoded, UnexpectedError>
  execute(queryStr: string, bindValues: PreparedBindValues | undefined): Effect.Effect<void, UnexpectedError>
  mutate(mutationEventEncoded: MutationEvent.Any, options: { persisted: boolean }): Effect.Effect<void, UnexpectedError>
  dangerouslyReset(mode: ResetMode): Effect.Effect<void, UnexpectedError>
  export: Effect.Effect<Uint8Array | undefined, UnexpectedError>
  /**
   * This is different from `export` since in `getInitialSnapshot` is usually the place for migrations etc to happen
   */
  getInitialSnapshot: Effect.Effect<Uint8Array, UnexpectedError>
  getMutationLogData: Effect.Effect<Uint8Array, UnexpectedError>
  shutdown: Effect.Effect<void, UnexpectedError>
  networkStatus: SubscriptionRef.SubscriptionRef<NetworkStatus>
}

export type GetRowsChangedCount = () => number

export type LockStatus = 'has-lock' | 'no-lock'

export type BootDb = {
  _tag: 'BootDb'
  execute(queryStr: string, bindValues?: PreparedBindValues): void
  mutate: <const TMutationArg extends ReadonlyArray<MutationEvent.Any>>(...list: TMutationArg) => void
  select<T>(queryStr: string, bindValues?: PreparedBindValues): ReadonlyArray<T>
  txn(callback: () => void): void
}

export class UnexpectedError extends Schema.TaggedError<UnexpectedError>()('LiveStore.UnexpectedError', {
  cause: Schema.AnyError,
}) {}

export class SqliteError extends Schema.TaggedError<SqliteError>()('LiveStore.SqliteError', {
  sql: Schema.String,
  bindValues: Schema.Record(Schema.String, Schema.Any),
  /** The SQLite result code */
  code: Schema.Number,
  /** The original SQLite3 error */
  cause: Schema.AnyError,
}) {}

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
  schema: LiveStoreSchema
  devtoolsEnabled: boolean
  bootStatusQueue: Queue.Queue<BootStatus>
}) => Effect.Effect<StoreAdapter, UnexpectedError>
