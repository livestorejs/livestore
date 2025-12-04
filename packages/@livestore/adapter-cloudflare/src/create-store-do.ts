import { LogConfig } from '@livestore/common'
import type { CfTypes, HelperTypes } from '@livestore/common-cf'
import { createStore, type LiveStoreSchema, provideOtel } from '@livestore/livestore'
import type * as CfSyncBackend from '@livestore/sync-cf/cf-worker'
import { makeDoRpcSync } from '@livestore/sync-cf/client'
import { Effect, Logger, Scope } from '@livestore/utils/effect'
import { makeAdapter } from './make-adapter.ts'

export type Env = {
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace<CfSyncBackend.SyncBackendRpcInterface>
}

export type CreateStoreDoOptions<TSchema extends LiveStoreSchema, TEnv, TState> = {
  /** LiveStore schema that defines state, migrations, and validators. */
  schema: TSchema
  /** Logical identifier for the store instance persisted inside the Durable Object. */
  storeId: string
  /** Unique identifier for the client that owns the Durable Object instance. */
  clientId: string
  /** Identifier for the LiveStore session running inside the Durable Object. */
  sessionId: string
  /** Runtime details about the Durable Object this store runs inside. Needed for sync backend to call back to this instance. */
  durableObject: {
    /** Durable Object state handle (e.g. `this.ctx`). */
    ctx: TState
    /** Environment bindings associated with the Durable Object. */
    env: TEnv
    /** Binding name Cloudflare uses to reach this Durable Object from other workers. */
    bindingName: HelperTypes.ExtractDurableObjectKeys<NoInfer<TEnv>>
  }
  /** RPC stub pointing at the sync backend Durable Object used for replication. */
  syncBackendStub: CfTypes.DurableObjectStub<CfSyncBackend.SyncBackendRpcInterface>
  /**
   * Enables live pull mode to receive sync updates via Durable Object RPC callbacks.
   *
   * @default false
   */
  livePull?: boolean
  /**
   * Clears existing Durable Object persistence before bootstrapping the store.
   *
   * Note: Only use this for development purposes.
   */
  resetPersistence?: boolean
} & LogConfig.WithLoggerOptions

// TODO Also support in Cloudflare workers outside of a durable object context.
export const createStoreDo = <
  TSchema extends LiveStoreSchema,
  TEnv,
  TState extends CfTypes.DurableObjectState = CfTypes.DurableObjectState,
>({
  schema,
  storeId,
  clientId,
  sessionId,
  durableObject,
  syncBackendStub,
  livePull = false,
  resetPersistence = false,
}: CreateStoreDoOptions<TSchema, TEnv, TState>) =>
  Effect.gen(function* () {
    const { ctx, bindingName } = durableObject
    const storage = ctx.storage
    const durableObjectId = ctx.id.toString()
    const scope = yield* Scope.make()

    const adapter = makeAdapter({
      clientId,
      sessionId,
      storage,
      resetPersistence,
      syncOptions: {
        backend: makeDoRpcSync({
          syncBackendStub,
          durableObjectContext: { bindingName, durableObjectId },
        }),
        livePull, // Uses DO RPC callbacks for reactive pull
        initialSyncOptions: { _tag: 'Blocking', timeout: 500 },
      },
    })

    return yield* createStore({ schema, adapter, storeId }).pipe(Scope.extend(scope), provideOtel({}))
  })

export const createStoreDoPromise = <
  TSchema extends LiveStoreSchema,
  TEnv,
  TState extends CfTypes.DurableObjectState = CfTypes.DurableObjectState,
>(
  options: CreateStoreDoOptions<TSchema, TEnv, TState>,
) =>
  createStoreDo(options).pipe(
    LogConfig.withLoggerConfig(options, {
      threadName: 'DoClient',
      defaultLogger: Logger.consoleWithThread('DoClient'),
    }),
    Effect.tapCauseLogPretty,
    Effect.runPromise,
  )
