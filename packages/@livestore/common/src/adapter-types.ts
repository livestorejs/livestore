import {
  type Cause,
  type Effect,
  type Queue,
  Schema,
  type Scope,
  type SubscriptionRef,
  type WebChannel,
} from '@livestore/utils/effect'

import type { ClientSessionLeaderThreadProxy } from './ClientSessionLeaderThreadProxy.js'
import type * as Devtools from './devtools/mod.js'
import type { IntentionalShutdownCause, SqliteError, UnexpectedError } from './errors.js'
import type { LiveStoreSchema } from './schema/mod.js'
import type { QueryBuilder } from './schema/state/sqlite/query-builder/api.js'
import type { PreparedBindValues } from './util.js'
export * as ClientSessionLeaderThreadProxy from './ClientSessionLeaderThreadProxy.js'
export * from './defs.js'
export * from './errors.js'

export interface PreparedStatement {
  execute(bindValues: PreparedBindValues | undefined, options?: { onRowsChanged?: (rowsChanged: number) => void }): void
  select<T>(bindValues: PreparedBindValues | undefined): ReadonlyArray<T>
  finalize(): void
  sql: string
}

export type SqliteDbSession = {
  changeset: () => Uint8Array | undefined
  finish: () => void
}

export type SqliteDbChangeset = {
  // TODO combining changesets (requires changes in the SQLite WASM binding)
  invert: () => SqliteDbChangeset
  apply: () => void
}

export interface ClientSession {
  /** SQLite database with synchronous API running in the same thread (usually in-memory) */
  sqliteDb: SqliteDb
  devtools: { enabled: false } | { enabled: true; pullLatch: Effect.Latch; pushLatch: Effect.Latch }
  clientId: string
  sessionId: string
  /** Status info whether current session is leader or not */
  lockStatus: SubscriptionRef.SubscriptionRef<LockStatus>
  shutdown: (cause: Cause.Cause<UnexpectedError | IntentionalShutdownCause>) => Effect.Effect<void>
  /** A proxy API to communicate with the leader thread */
  leaderThread: ClientSessionLeaderThreadProxy
  /** A unique identifier for the current instance of the client session. Used for debugging purposes. */
  debugInstanceId: string
}

/**
 * Common interface for SQLite databases used by LiveStore to facilitate a consistent API across different platforms.
 * Always assumes a synchronous SQLite build with the `bytecode` and `session` extensions enabled.
 * Can be either in-memory or persisted to disk.
 */
export interface SqliteDb<TReq = any, TMetadata extends TReq = TReq> {
  _tag: 'SqliteDb'
  metadata: TMetadata
  prepare(queryStr: string): PreparedStatement
  execute(
    queryStr: string,
    bindValues?: PreparedBindValues | undefined,
    options?: { onRowsChanged?: (rowsChanged: number) => void },
  ): void
  execute(queryBuilder: QueryBuilder.Any, options?: { onRowsChanged?: (rowsChanged: number) => void }): void

  select<T>(queryStr: string, bindValues?: PreparedBindValues | undefined): ReadonlyArray<T>
  select<T>(queryBuilder: QueryBuilder<T, any, any>): ReadonlyArray<T>

  export(): Uint8Array
  import: (data: Uint8Array | SqliteDb<TReq>) => void
  close(): void
  destroy(): void
  session(): SqliteDbSession
  makeChangeset: (data: Uint8Array) => SqliteDbChangeset
}

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
) => Effect.Effect<SqliteDb<TReq, Extract<TMetadata, { _tag: TInput['_tag'] }>>, SqliteError | UnexpectedError, R>

export const PersistenceInfo = Schema.Struct(
  {
    fileName: Schema.String,
  },
  { key: Schema.String, value: Schema.Any },
).annotations({ title: 'LiveStore.PersistenceInfo' })

export type PersistenceInfo<With extends {} = {}> = typeof PersistenceInfo.Type & With

export type ResetMode = 'all-data' | 'only-app-db'

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
).annotations({ title: 'BootStatus' })

export type BootStatus = typeof BootStatus.Type

/**
 * Can be used in queries to refer to the current session id.
 * Will be replaced with the actual session id at runtime
 *
 * In client document table:
 * ```ts
 * const uiState = State.SQLite.clientDocument({
 *   name: 'ui_state',
 *   schema: Schema.Struct({
 *     theme: Schema.Literal('dark', 'light', 'system'),
 *     user: Schema.String,
 *     showToolbar: Schema.Boolean,
 *   }),
 *   default: { value: defaultFrontendState, id: SessionIdSymbol },
 * })
 * ```
 *
 * Or in a client document query:
 * ```ts
 * const query$ = queryDb(tables.uiState.get(SessionIdSymbol))
 * ```
 */
export const SessionIdSymbol = Symbol.for('@livestore/session-id')
export type SessionIdSymbol = typeof SessionIdSymbol

export type LockStatus = 'has-lock' | 'no-lock'

// TODO possibly allow a combination of these options
// TODO allow a way to stream the migration progress back to the app
export type MigrationOptions =
  | {
      strategy: 'auto'
      hooks?: Partial<MigrationHooks>
      logging?: {
        excludeAffectedRows?: (sqlStmt: string) => boolean
      }
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

export type MigrationHook = (db: SqliteDb) => void | Promise<void> | Effect.Effect<void, unknown>

export interface ClientSessionDevtoolsChannel
  extends WebChannel.WebChannel<Devtools.ClientSession.MessageToApp, Devtools.ClientSession.MessageFromApp> {}

export type ConnectDevtoolsToStore = (
  storeDevtoolsChannel: ClientSessionDevtoolsChannel,
) => Effect.Effect<void, UnexpectedError, Scope.Scope>

export type Adapter = (args: AdapterArgs) => Effect.Effect<ClientSession, UnexpectedError, Scope.Scope>

export interface AdapterArgs {
  schema: LiveStoreSchema
  storeId: string
  devtoolsEnabled: boolean
  debugInstanceId: string
  bootStatusQueue: Queue.Queue<BootStatus>
  shutdown: (cause: Cause.Cause<any>) => Effect.Effect<void>
  connectDevtoolsToStore: ConnectDevtoolsToStore
  /**
   * Payload that will be passed to the sync backend when connecting
   *
   * @default undefined
   */
  syncPayload: Schema.JsonValue | undefined
}
