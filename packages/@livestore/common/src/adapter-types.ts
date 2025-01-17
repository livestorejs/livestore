import type { Cause, Queue, Scope, SubscriptionRef, WebChannel } from '@livestore/utils/effect'
import { Effect, Schema, Stream } from '@livestore/utils/effect'

import type * as Devtools from './devtools/index.js'
import type { LiveStoreSchema, MutationEvent } from './schema/index.js'
import type { PayloadUpstream } from './sync/syncstate.js'
import type { PreparedBindValues } from './util.js'

export interface PreparedStatement {
  execute(bindValues: PreparedBindValues | undefined, options?: { onRowsChanged?: (rowsChanged: number) => void }): void
  select<T>(bindValues: PreparedBindValues | undefined): ReadonlyArray<T>
  finalize(): void
  sql: string
}

export type SynchronousDatabaseSession = {
  changeset: () => Uint8Array
  finish: () => void
}

export type SynchronousDatabaseChangeset = {
  // TODO combining changesets (requires changes in the SQLite WASM binding)
  invert: () => SynchronousDatabaseChangeset
  apply: () => void
}

export type ClientSession = {
  /** SQLite database with synchronous API running in the same thread (usually in-memory) */
  syncDb: SynchronousDatabase
  /** The coordinator is responsible for persisting the database, syncing etc */
  coordinator: Coordinator
}

export type SynchronousDatabase<TReq = any, TMetadata extends TReq = TReq> = {
  _tag: 'SynchronousDatabase'
  metadata: TMetadata
  prepare(queryStr: string): PreparedStatement
  execute(
    queryStr: string,
    bindValues?: PreparedBindValues | undefined,
    options?: { onRowsChanged?: (rowsChanged: number) => void },
  ): void
  select<T>(queryStr: string, bindValues?: PreparedBindValues | undefined): ReadonlyArray<T>
  export(): Uint8Array
  import: (data: Uint8Array | SynchronousDatabase<TReq>) => void
  close(): void
  destroy(): void
  session(): SynchronousDatabaseSession
  makeChangeset: (data: Uint8Array) => SynchronousDatabaseChangeset
}

export type MakeSynchronousDatabase<
  TReq = { dbPointer: number; persistenceInfo: PersistenceInfo },
  TInput_ extends { _tag: string } = { _tag: string },
  TMetadata_ extends TReq = TReq,
  R = never,
> = <
  TInput extends TInput_,
  TMetadata extends TMetadata_ & { _tag: TInput['_tag'] } = TMetadata_ & { _tag: TInput['_tag'] },
>(
  input: TInput,
) => Effect.Effect<
  SynchronousDatabase<TReq, Extract<TMetadata, { _tag: TInput['_tag'] }>>,
  SqliteError | UnexpectedError,
  R
>

export const PersistenceInfo = Schema.Struct(
  {
    fileName: Schema.String,
  },
  { key: Schema.String, value: Schema.Any },
).annotations({ title: 'LiveStore.PersistenceInfo' })

export type PersistenceInfo<With extends {} = {}> = typeof PersistenceInfo.Type & With

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
  devtools: {
    enabled: boolean
    // TODO incorporate sessionId and rethink appHostId
    appHostId: string
  }
  sessionId: string
  // TODO is exposing the lock status really needed (or only relevant for web adapter?)
  lockStatus: SubscriptionRef.SubscriptionRef<LockStatus>
  mutations: {
    pull: Stream.Stream<{ payload: PayloadUpstream; remaining: number }, UnexpectedError>
    push(
      batch: ReadonlyArray<MutationEvent.AnyEncoded>,
      options: { persisted: boolean },
    ): Effect.Effect<void, UnexpectedError>
    /** Can be called synchronously */
    nextMutationEventIdPair: (opts: { localOnly: boolean }) => EventIdPair
    /** Used to initially get the current mutation event id to use as `parentId` for the next mutation event */
    getCurrentMutationEventId: Effect.Effect<EventId, UnexpectedError>
  }
  export: Effect.Effect<Uint8Array, UnexpectedError>
  getMutationLogData: Effect.Effect<Uint8Array, UnexpectedError>
  networkStatus: SubscriptionRef.SubscriptionRef<NetworkStatus>
}

/**
 * Can be used in queries to refer to the current session id.
 * Will be replaced with the actual session id at runtime
 *
 * Example:
 * ```ts
 * const query$ = queryDb(tables.app.query.row(SessionIdSymbol), SessionIdSymbol)
 * ```
 */
export const SessionIdSymbol = Symbol.for('@livestore/session-id')
export type SessionIdSymbol = typeof SessionIdSymbol

export type LockStatus = 'has-lock' | 'no-lock'

/**
 * LiveStore event id value consisting of a globally unique event sequence number
 * and a local sequence number.
 *
 * The local sequence number is only used for localOnly mutations and starts from 0 for each global sequence number.
 */
export type EventId = { global: number; local: number }

export const EventId = Schema.Struct({
  global: Schema.Number,
  local: Schema.Number,
}).annotations({ title: 'LiveStore.EventId' })

/**
 * Compare two event ids i.e. checks if the first event id is less than the second.
 */
export const compareEventIds = (a: EventId, b: EventId) => {
  if (a.global !== b.global) {
    return a.global - b.global
  }
  return a.local - b.local
}

export type EventIdPair = { id: EventId; parentId: EventId }

export const ROOT_ID = { global: -1, local: 0 } satisfies EventId

export class UnexpectedError extends Schema.TaggedError<UnexpectedError>()('LiveStore.UnexpectedError', {
  cause: Schema.Defect,
  note: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Any),
}) {
  static mapToUnexpectedError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((cause) => (Schema.is(UnexpectedError)(cause) ? cause : new UnexpectedError({ cause }))),
      Effect.catchAllDefect((cause) => new UnexpectedError({ cause })),
    )

  static mapToUnexpectedErrorStream = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    stream.pipe(
      Stream.mapError((cause) => (Schema.is(UnexpectedError)(cause) ? cause : new UnexpectedError({ cause }))),
    )
}

export class IntentionalShutdownCause extends Schema.TaggedError<IntentionalShutdownCause>()(
  'LiveStore.IntentionalShutdownCause',
  {
    reason: Schema.Literal('devtools-reset', 'devtools-import'),
  },
) {}

export class SqliteError extends Schema.TaggedError<SqliteError>()('LiveStore.SqliteError', {
  query: Schema.optional(
    Schema.Struct({
      sql: Schema.String,
      bindValues: Schema.Union(Schema.Record({ key: Schema.String, value: Schema.Any }), Schema.Array(Schema.Any)),
    }),
  ),
  /** The SQLite result code */
  code: Schema.optional(Schema.Number),
  /** The original SQLite3 error */
  cause: Schema.Defect,
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
      migrate: (oldDb: Uint8Array) => Uint8Array | Promise<Uint8Array> | Effect.Effect<Uint8Array, unknown>
    }

export type MigrationHooks = {
  /** Runs on the empty in-memory database with no database schemas applied yet */
  init: MigrationHook
  /** Runs before applying the migration strategy but after table schemas have been applied and singleton rows have been created */
  pre: MigrationHook
  /** Runs after applying the migration strategy before creating export snapshot and closing the database */
  post: MigrationHook
}

export type MigrationHook = (db: SynchronousDatabase) => void | Promise<void> | Effect.Effect<void, unknown>

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

export type StoreDevtoolsChannel = WebChannel.WebChannel<
  Devtools.MessageToAppHostStore,
  Devtools.MessageFromAppHostStore
>

export type ConnectDevtoolsToStore = (
  storeDevtoolsChannel: StoreDevtoolsChannel,
) => Effect.Effect<void, UnexpectedError, Scope.Scope>

export type Adapter = (opts: {
  schema: LiveStoreSchema
  storeId: string
  devtoolsEnabled: boolean
  bootStatusQueue: Queue.Queue<BootStatus>
  shutdown: (cause: Cause.Cause<any>) => Effect.Effect<void>
  connectDevtoolsToStore: ConnectDevtoolsToStore
}) => Effect.Effect<ClientSession, UnexpectedError, Scope.Scope>
