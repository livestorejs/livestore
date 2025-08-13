import {
  type Effect,
  type Exit,
  type Queue,
  Schema,
  type Scope,
  type SubscriptionRef,
  type WebChannel,
} from '@livestore/utils/effect'

import type { ClientSessionLeaderThreadProxy } from './ClientSessionLeaderThreadProxy.ts'
import type * as Devtools from './devtools/mod.ts'
import type {
  IntentionalShutdownCause,
  MaterializerHashMismatchError,
  SqliteError,
  SyncError,
  UnexpectedError,
} from './errors.ts'
import type { LiveStoreSchema } from './schema/mod.ts'
import type { SqliteDb } from './sqlite-types.ts'
import type { InvalidPullError, IsOfflineError } from './sync/index.js'

export * as ClientSessionLeaderThreadProxy from './ClientSessionLeaderThreadProxy.ts'
export * from './defs.ts'
export * from './errors.ts'
export * from './sqlite-types.ts'

export interface ClientSession {
  /** SQLite database with synchronous API running in the same thread (usually in-memory) */
  sqliteDb: SqliteDb
  devtools: { enabled: false } | { enabled: true; pullLatch: Effect.Latch; pushLatch: Effect.Latch }
  clientId: string
  sessionId: string
  /** Status info whether current session is leader or not */
  lockStatus: SubscriptionRef.SubscriptionRef<LockStatus>
  shutdown: (
    cause: Exit.Exit<IntentionalShutdownCause, UnexpectedError | SyncError | MaterializerHashMismatchError>,
  ) => Effect.Effect<void>
  /** A proxy API to communicate with the leader thread */
  leaderThread: ClientSessionLeaderThreadProxy
  /** A unique identifier for the current instance of the client session. Used for debugging purposes. */
  debugInstanceId: string
}

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
      migrate: (
        oldDb: Uint8Array<ArrayBuffer>,
      ) => Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>> | Effect.Effect<Uint8Array<ArrayBuffer>, unknown>
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
  shutdown: (
    exit: Exit.Exit<
      IntentionalShutdownCause,
      UnexpectedError | SyncError | MaterializerHashMismatchError | InvalidPullError | SqliteError | IsOfflineError
    >,
  ) => Effect.Effect<void>
  connectDevtoolsToStore: ConnectDevtoolsToStore
  /**
   * Payload that will be passed to the sync backend when connecting
   *
   * @default undefined
   */
  syncPayload: Schema.JsonValue | undefined
}
