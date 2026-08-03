import { UnknownError } from '@livestore/common'
import type { CfTypes } from '@livestore/common-cf'
import { EventSequenceNumber, State } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Context, Effect, Layer, Predicate, Semaphore } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import type { Env, MakeDurableObjectClassOptions, RpcSubscription } from '../shared.ts'
import { contextTable, eventlogTable } from './sqlite.ts'
import { makeStorage, type StorageEngine, type SyncStorage } from './sync-storage.ts'

const CacheSymbol = Symbol('Cache')
const InitializationSemaphoreSymbol = Symbol('InitializationSemaphore')

export interface Options {
  doSelf: CfTypes.DurableObject & {
    ctx: CfTypes.DurableObjectState
    env: Env
  }
  doOptions: MakeDurableObjectClassOptions | undefined
  from: CfTypes.Request | { storeId: string }
}

export type DoCtxInput = Options

export interface Service {
  readonly storeId: string
  readonly backendId: string
  readonly currentHeadRef: { current: EventSequenceNumber.Global.Type }
  readonly updateCurrentHead: (currentHead: EventSequenceNumber.Global.Type) => void
  /** Serializes push admission across concurrent RPC fibers for this Durable Object instance. */
  readonly pushSemaphore: Semaphore.Semaphore
  readonly storage: SyncStorage
  readonly doOptions: MakeDurableObjectClassOptions | undefined
  readonly env: Env
  readonly ctx: CfTypes.DurableObjectState
  readonly rpcSubscriptions: Map<string, RpcSubscription>
}

export class DoCtx extends Context.Service<DoCtx, Service>()('@livestore/sync-cf/DoCtx') {}

type DurableObjectCacheHost = Options['doSelf'] & {
  [CacheSymbol]?: Service
  [InitializationSemaphoreSymbol]?: Semaphore.Semaphore
}

export const make = Effect.fn(
  function* ({ doSelf, doOptions, from }: Options) {
    const cacheHost = doSelf as DurableObjectCacheHost
    if (cacheHost[CacheSymbol] !== undefined) {
      return DoCtx.of(cacheHost[CacheSymbol])
    }

    // Request layers can be constructed concurrently during the first RPCs to a DO.
    // Install this lock synchronously so every contender shares the same initializer.
    const initializationSemaphore = cacheHost[InitializationSemaphoreSymbol] ?? Semaphore.makeUnsafe(1)
    cacheHost[InitializationSemaphoreSymbol] = initializationSemaphore

    return yield* initializationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        if (cacheHost[CacheSymbol] !== undefined) {
          return DoCtx.of(cacheHost[CacheSymbol])
        }

        const getStoreId = (from: CfTypes.Request | { storeId: string }) => {
          if (Predicate.hasProperty(from, 'url') === true) {
            const url = new URL(from.url)
            return (
              url.searchParams.get('storeId') ?? shouldNeverHappen(`No storeId provided in request URL search params`)
            )
          }
          return from.storeId
        }

        const storeId = getStoreId(from)
        const engine = yield* resolveStorageEngine(doOptions?.storage, doSelf.env)

        const storage = makeStorage(doSelf.ctx, storeId, engine)

        // Initialize database tables
        {
          const colSpec = State.SQLite.makeColumnSpec(eventlogTable.sqliteDef.ast)
          if (engine._tag === 'd1') {
            // D1 database is async, so we need to use a promise
            yield* Effect.promise(() =>
              engine.db.exec(`CREATE TABLE IF NOT EXISTS "${storage.dbName}" (${colSpec}) strict`),
            )
          } else {
            // DO SQLite table lives in Durable Object storage
            doSelf.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS "${storage.dbName}" (${colSpec}) strict`)
          }
        }
        {
          const colSpec = State.SQLite.makeColumnSpec(contextTable.sqliteDef.ast)
          doSelf.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS "${contextTable.sqliteDef.name}" (${colSpec}) strict`)
        }

        const storageRow = doSelf.ctx.storage.sql
          .exec(`SELECT * FROM "${contextTable.sqliteDef.name}" WHERE storeId = ?`, storeId)
          .toArray()[0] as typeof contextTable.rowSchema.Type | undefined

        const currentHeadRef = { current: storageRow?.currentHead ?? EventSequenceNumber.Client.ROOT.global }
        const pushSemaphore = yield* Semaphore.make(1)

        // TODO: Reconcile this persisted head with the event log's highest sequence number.
        // D1 event batches and this DO-local context row cannot be updated atomically, so a
        // failure between those writes can leave push admission using a stale head after restart.

        // Should be the same backendId for lifetime of the Durable Object
        const backendId = storageRow?.backendId ?? nanoid()

        const updateCurrentHead = (currentHead: EventSequenceNumber.Global.Type) => {
          doSelf.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO "${contextTable.sqliteDef.name}" (storeId, currentHead, backendId) VALUES (?, ?, ?)`,
            storeId,
            currentHead,
            backendId,
          )

          currentHeadRef.current = currentHead
        }

        const rpcSubscriptions = new Map<string, RpcSubscription>()

        const storageCache = {
          storeId,
          backendId,
          currentHeadRef,
          updateCurrentHead,
          pushSemaphore,
          storage,
          doOptions,
          env: doSelf.env,
          ctx: doSelf.ctx,
          rpcSubscriptions,
        }

        cacheHost[CacheSymbol] = storageCache

        // Set initial current head to root
        if (storageRow === undefined) {
          updateCurrentHead(EventSequenceNumber.Client.ROOT.global)
        }

        return DoCtx.of(storageCache)
      }),
    )
  },
  UnknownError.mapToUnknownError,
  Effect.withSpan('@livestore/sync-cf:durable-object:makeDoCtx'),
)

export const layer = (options: Options) => Layer.effect(DoCtx, make(options))

/** Resolves storage configuration into the concrete database handle used at runtime. */
const resolveStorageEngine = Effect.fn(function* (
  storageOption: MakeDurableObjectClassOptions['storage'],
  env: Env,
): Effect.fn.Return<StorageEngine, UnknownError> {
  if (storageOption === undefined || storageOption._tag === 'do-sqlite') {
    return { _tag: 'do-sqlite' }
  }

  if (storageOption._tag === 'd1') {
    const db = (env as Record<string, CfTypes.D1Database | undefined>)[storageOption.binding]
    if (db === undefined) {
      return yield* UnknownError.make({
        cause: new Error(`D1 binding '${storageOption.binding}' not found on env`),
      })
    }

    return { _tag: 'd1', db }
  }

  return shouldNeverHappen(`Invalid storage engine`, storageOption)
})
