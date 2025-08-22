import type { UnexpectedError } from '@livestore/common'
import { createStore, type LiveStoreSchema, provideOtel, type Store, type Unsubscribe } from '@livestore/livestore'
import type * as CfSyncBackend from '@livestore/sync-cf/cf-worker'
import { makeDoRpcSync } from '@livestore/sync-cf/client'
import { Effect, Logger, LogLevel, Scope } from '@livestore/utils/effect'
import type * as CfWorker from './cf-types.ts'
import { makeAdapter } from './make-adapter.ts'

declare class Response extends CfWorker.Response {}

export type MakeDurableObjectClassOptions<TSchema extends LiveStoreSchema = LiveStoreSchema.Any> = {
  schema: TSchema
  // storeId: string
  clientId: string
  sessionId: string
  onStoreReady?: (store: Store<TSchema>) => Effect.SyncOrPromiseOrEffect<void, UnexpectedError>
  // makeStore?: (adapter: Adapter) => Promise<Store<TSchema>>
  // onLiveStoreEvent?: (event: LiveStoreEvent.ForSchema<TSchema>) => Promise<void>
  registerQueries?: (store: Store<TSchema>) => Effect.SyncOrPromiseOrEffect<ReadonlyArray<Unsubscribe>>
  syncBackendUrl?: string
  // Hook for custom request handling (e.g., testing endpoints)
  handleCustomRequest?: (
    request: CfWorker.Request,
    ensureStore: Effect.Effect<Store<TSchema>, UnexpectedError, never>,
  ) => Effect.SyncOrPromiseOrEffect<CfWorker.Response | undefined, UnexpectedError>
}

export type Env = {
  SYNC_BACKEND_DO: CfWorker.DurableObjectNamespace
}

export type MakeDurableObjectClass = <TSchema extends LiveStoreSchema = LiveStoreSchema.Any>(
  options: MakeDurableObjectClassOptions<TSchema>,
) => {
  new (ctx: CfWorker.DurableObjectState, env: Env): CfWorker.DurableObject & CfWorker.Rpc.DurableObjectBranded
}

export type CreateStoreDoOptions<TSchema extends LiveStoreSchema = LiveStoreSchema.Any> = {
  schema: TSchema
  storeId: string
  clientId: string
  sessionId: string
  storage: CfWorker.DurableObjectStorage
  syncBackendDurableObject: CfWorker.DurableObjectStub<CfSyncBackend.SyncBackendRpcInterface>
  durableObjectId: string
  bindingName: string
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
}: CreateStoreDoOptions<TSchema>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()

    const adapter = makeAdapter({
      clientId,
      sessionId,
      storage,
      syncOptions: {
        backend: makeDoRpcSync({
          syncBackendStub: syncBackendDurableObject,
          durableObjectContext: { bindingName, durableObjectId },
        }),
        livePull: false, // Uses DO RPC callbacks for reactive pull
        // backend: makeHttpSync({ url: `http://localhost:8787`, livePull: { pollInterval: 500 } }),
        initialSyncOptions: { _tag: 'Blocking', timeout: 500 },
        // backend: makeWsSyncProviderClient({ durableObject: syncBackendDurableObject }),
      },
    })

    return yield* createStore({ schema, adapter, storeId }).pipe(Scope.extend(scope), provideOtel({}))
  })

export const createStoreDoPromise = <TSchema extends LiveStoreSchema = LiveStoreSchema.Any>(
  options: CreateStoreDoOptions<TSchema>,
) =>
  createStoreDo(options).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Logger.prettyWithThread('DoClient')),
    Effect.tapCauseLogPretty,
    Effect.runPromise,
  )
