import { createStore, type LiveStoreSchema, provideOtel } from '@livestore/livestore'
import type * as CfSyncBackend from '@livestore/sync-cf/cf-worker'
import { makeDoRpcSync } from '@livestore/sync-cf/client'
import { Effect, Logger, LogLevel, Scope } from '@livestore/utils/effect'
import type * as CfWorker from './cf-types.ts'
import { makeAdapter } from './make-adapter.ts'

export type Env = {
  SYNC_BACKEND_DO: CfWorker.DurableObjectNamespace
}

/**
 * Options used to initialize the LiveStore Durable Object runtime.
 */
export type CreateStoreDoOptions<TSchema extends LiveStoreSchema = LiveStoreSchema.Any> = {
  /** LiveStore schema that defines state, migrations, and validators. */
  schema: TSchema
  /** Logical identifier for the store instance persisted inside the Durable Object. */
  storeId: string
  /** Unique identifier for the client that owns the Durable Object instance. */
  clientId: string
  /** Identifier for the LiveStore session running inside the Durable Object. */
  sessionId: string
  /** Cloudflare Durable Object storage binding backing the local SQLite files. */
  storage: CfWorker.DurableObjectStorage
  /** RPC stub pointing at the sync backend Durable Object used for replication. */
  syncBackendDurableObject: CfWorker.DurableObjectStub<CfSyncBackend.SyncBackendRpcInterface>
  /**
   * Durable Object identifier for the current instance, forwarded to the sync backend.
   *
   * @example
   * ```ts
   * const durableObjectId = this.state.id.toString()
   * ```
   */
  durableObjectId: string
  /** Binding name Cloudflare uses to reach this Durable Object from other workers. */
  bindingName: string
  /** Enables live pull mode to receive sync updates via Durable Object RPC callbacks. */
  livePull?: boolean
  /**
   * Clears existing Durable Object persistence before bootstrapping the store.
   *
   * Note: Only use this for development purposes.
   */
  resetPersistence?: boolean
}

export const createStoreDo = <TSchema extends LiveStoreSchema = LiveStoreSchema.Any>({
  schema,
  storeId,
  clientId,
  sessionId,
  storage,
  syncBackendDurableObject,
  durableObjectId,
  bindingName,
  livePull = false,
  resetPersistence = false,
}: CreateStoreDoOptions<TSchema>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()

    const adapter = makeAdapter({
      clientId,
      sessionId,
      storage,
      resetPersistence,
      syncOptions: {
        backend: makeDoRpcSync({
          syncBackendStub: syncBackendDurableObject,
          durableObjectContext: { bindingName, durableObjectId },
        }),
        livePull, // Uses DO RPC callbacks for reactive pull
        initialSyncOptions: { _tag: 'Blocking', timeout: 500 },
      },
    })

    return yield* createStore({ schema, adapter, storeId }).pipe(Scope.extend(scope), provideOtel({}))
  })

export const createStoreDoPromise = <TSchema extends LiveStoreSchema = LiveStoreSchema.Any>(
  options: CreateStoreDoOptions<TSchema>,
) =>
  createStoreDo(options).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Logger.consoleWithThread('DoClient')),
    Effect.tapCauseLogPretty,
    Effect.runPromise,
  )
