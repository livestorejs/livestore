import { UnexpectedError } from '@livestore/common'
import { createStore, type LiveStoreSchema, provideOtel, type Store, type Unsubscribe } from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Logger, LogLevel, Scope } from '@livestore/utils/effect'
import type * as CfWorker from './cf-types.ts'
import { makeAdapter } from './make-adapter.ts'
import { makeSyncProviderClient } from './sync-provider-client.ts'

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

/**
 * Creates a Durable Object class for handling LiveStore client functionality.
 *
 * Example:
 * ```ts
 * export class ClientDO extends makeClientDurableObject({
 *   schema,
 *   storeId: 'some-store-id',
 * }) {}
 */
export const makeClientDurableObject: MakeDurableObjectClass = (options) => {
  return class DoClientBase implements CfWorker.DurableObject, CfWorker.Rpc.DurableObjectBranded {
    __DURABLE_OBJECT_BRAND = 'ClientDurableObject' as never
    ctx: CfWorker.DurableObjectState
    env: Env

    protected store: Store<any> | undefined
    private storeId: string | undefined

    private scope = Scope.make().pipe(Effect.runSync)

    constructor(ctx: CfWorker.DurableObjectState, env: Env) {
      this.ctx = ctx
      this.env = env
    }

    fetch = async (request: CfWorker.Request) =>
      Effect.gen(this, function* () {
        const url = new URL(request.url)
        this.storeId = url.searchParams.get('storeId') ?? shouldNeverHappen(`No storeId provided`)

        // Check for custom request handler first
        if (options.handleCustomRequest) {
          const customResponse = yield* Effect.tryAll(() =>
            options.handleCustomRequest!(request, this.ensureStoreInitialized),
          ).pipe(UnexpectedError.mapToUnexpectedError)
          if (customResponse !== undefined) {
            return customResponse
          }
        }

        yield* this.ensureStoreInitialized

        return new Response('Client DO initialized')
      }).pipe(this.runEffect)

    private runEffect = <T>(effect: Effect.Effect<T, any, never>) =>
      effect.pipe(
        Effect.tapCauseLogPretty,
        Effect.provide(Logger.prettyWithThread('DoClient')),
        Logger.withMinimumLogLevel(LogLevel.Debug),
        Effect.runPromise,
      )

    /** Gets called every 30s to ensure the store stays initialized */
    alarm = () => this.ensureStoreInitialized.pipe(Effect.asVoid, this.runEffect)

    /* ---------- helpers ---------- */

    // Shared store initialization (used by both fetch and hibernation)
    private ensureStoreInitialized = Effect.gen(this, function* () {
      if (!this.storeId) {
        return shouldNeverHappen(`storeId is not set`)
      }

      if (!this.store) {
        const syncBackendDurableObject = this.env.SYNC_BACKEND_DO.get(this.env.SYNC_BACKEND_DO.idFromName(this.storeId))

        const adapter = makeAdapter({
          clientId: options.clientId,
          sessionId: options.sessionId,
          storage: this.ctx.storage,
          syncOptions: {
            backend: makeSyncProviderClient({ durableObject: syncBackendDurableObject }),
          },
        })

        // Create the real LiveStore with SQLite persistence
        this.store = yield* createStore({ schema: options.schema, adapter, storeId: this.storeId }).pipe(
          Scope.extend(this.scope),
          provideOtel({}),
        )

        // yield* Effect.addFinalizerLog('closing store again')

        if (options?.onStoreReady) {
          options.onStoreReady(this.store)
        }

        // Register queries if provided
        if (options?.registerQueries) {
          yield* Effect.promise(async () => options.registerQueries!(this.store!))
        }
      }

      /* schedule the next health-check 30 s out */
      yield* Effect.promise(() => this.ctx.storage.setAlarm(Date.now() + 30_000))

      return this.store
    })
  }
}

export type CreateStoreDoOptions<TSchema extends LiveStoreSchema = LiveStoreSchema.Any> = {
  schema: TSchema
  storeId: string
  clientId: string
  sessionId: string
  storage: CfWorker.DurableObjectStorage
  syncBackendDurableObject: CfWorker.DurableObjectStub
}

export const createStoreDo = <TSchema extends LiveStoreSchema = LiveStoreSchema.Any>({
  schema,
  storeId,
  clientId,
  sessionId,
  storage,
  syncBackendDurableObject,
}: CreateStoreDoOptions<TSchema>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()

    const adapter = makeAdapter({
      clientId,
      sessionId,
      storage,
      syncOptions: {
        backend: makeSyncProviderClient({ durableObject: syncBackendDurableObject }),
      },
    })

    return yield* createStore({ schema, adapter, storeId }).pipe(Scope.extend(scope), provideOtel({}))
  })

export const createStoreDoPromise = <TSchema extends LiveStoreSchema = LiveStoreSchema.Any>(
  options: CreateStoreDoOptions<TSchema>,
) => createStoreDo(options).pipe(Effect.runPromise)
