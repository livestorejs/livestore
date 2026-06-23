import { UnknownError } from '@livestore/common'
import type { CfTypes } from '@livestore/common-cf'
import { EventSequenceNumber, State } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Predicate } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

import type { Env, MakeDurableObjectClassOptions, RpcSubscription } from '../shared.ts'
import { contextTable, eventlogTable, rpcSubscriptionTable } from './sqlite.ts'
import { makeStorage } from './sync-storage.ts'

/** SQLite-backed DO-RPC live-pull subscription registry. */
export interface RpcSubscriptions {
  readonly set: (subscription: Omit<RpcSubscription, 'generation'>) => void
  readonly all: () => ReadonlyArray<RpcSubscription>
  /** Match on `generation` so a newer re-subscribe isn't clobbered. */
  readonly remove: (durableObjectId: string, generation: number) => void
}

const CacheSymbol = Symbol('Cache')

export interface DoCtxInput {
  doSelf: CfTypes.DurableObject & {
    ctx: CfTypes.DurableObjectState
    env: Env
  }
  doOptions: MakeDurableObjectClassOptions | undefined
  from: CfTypes.Request | { storeId: string }
}

export class DoCtx extends Effect.Service<DoCtx>()('DoCtx', {
  effect: Effect.fn(
    function* ({ doSelf, doOptions, from }: DoCtxInput) {
      if ((doSelf as any)[CacheSymbol] !== undefined) {
        return (doSelf as any)[CacheSymbol] as never
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
      // Resolve storage engine
      const makeEngine = Effect.gen(function* () {
        const opt = doOptions?.storage
        if (opt?._tag === 'd1') {
          const db = (doSelf.env as any)[opt.binding]
          if (db == null) {
            return yield* UnknownError.make({ cause: new Error(`D1 binding '${opt.binding}' not found on env`) })
          }
          return { _tag: 'd1' as const, db }
        } else if (opt?._tag === 'do-sqlite' || opt === undefined) {
          return { _tag: 'do-sqlite' as const }
        } else return shouldNeverHappen(`Invalid storage engine`, opt)
      })

      const engine = yield* makeEngine

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
      {
        const colSpec = State.SQLite.makeColumnSpec(rpcSubscriptionTable.sqliteDef.ast)
        doSelf.ctx.storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS "${rpcSubscriptionTable.sqliteDef.name}" (${colSpec}) strict`,
        )
      }

      const storageRow = doSelf.ctx.storage.sql
        .exec(`SELECT * FROM "${contextTable.sqliteDef.name}" WHERE storeId = ?`, storeId)
        .toArray()[0] as typeof contextTable.rowSchema.Type | undefined

      const currentHeadRef = { current: storageRow?.currentHead ?? EventSequenceNumber.Client.ROOT.global }

      // TODO do concistency check with eventlog table to make sure the head is consistent

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

        // I still don't know why we need to re-assign this ref to the `doSelf` object but somehow this seems to be needed 😵‍💫
        // @ts-expect-error
        doSelf[CacheSymbol].currentHeadRef = { current: currentHead }
      }

      const rpcSubscriptions = makeRpcSubscriptions(doSelf.ctx)

      const storageCache = {
        storeId,
        backendId,
        currentHeadRef,
        updateCurrentHead,
        storage,
        doOptions,
        env: doSelf.env,
        ctx: doSelf.ctx,
        rpcSubscriptions,
      }

      ;(doSelf as any)[CacheSymbol] = storageCache

      // Set initial current head to root
      if (storageRow === undefined) {
        updateCurrentHead(EventSequenceNumber.Client.ROOT.global)
      }

      return storageCache
    },
    UnknownError.mapToUnknownError,
    Effect.withSpan('@livestore/sync-cf:durable-object:makeDoCtx'),
  ),
}) {}

const makeRpcSubscriptions = (ctx: CfTypes.DurableObjectState): RpcSubscriptions => {
  const table = rpcSubscriptionTable.sqliteDef.name

  // Monotonic compare-and-delete token (NOT a timestamp); seeded from the persisted max to stay increasing
  // across hibernation, so same-turn re-subscribes get distinct tokens and a stale reap can't clobber.
  const seed = ctx.storage.sql
    .exec(`SELECT MAX(generation) AS maxGeneration FROM "${table}"`)
    .toArray()[0] as unknown as { maxGeneration: number | null } | undefined
  let lastGeneration = seed?.maxGeneration ?? 0
  const nextGeneration = () => (lastGeneration += 1)

  return {
    set: (subscription) =>
      ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO "${table}" (durableObjectId, bindingName, requestId, storeId, payload, generation) VALUES (?, ?, ?, ?, ?, ?)`,
        subscription.callerContext.durableObjectId,
        subscription.callerContext.bindingName,
        subscription.requestId,
        subscription.storeId,
        subscription.payload === undefined ? null : JSON.stringify(subscription.payload),
        nextGeneration(),
      ),
    all: () => {
      const rows = ctx.storage.sql
        .exec(`SELECT * FROM "${table}"`)
        .toArray() as Array<typeof rpcSubscriptionTable.rowSchema.Type>
      return rows.map(
        (row): RpcSubscription => ({
          storeId: row.storeId,
          requestId: row.requestId,
          generation: row.generation,
          callerContext: { bindingName: row.bindingName, durableObjectId: row.durableObjectId },
          ...(row.payload !== null ? { payload: JSON.parse(row.payload) } : {}),
        }),
      )
    },
    remove: (durableObjectId, generation) =>
      ctx.storage.sql.exec(
        `DELETE FROM "${table}" WHERE durableObjectId = ? AND generation = ?`,
        durableObjectId,
        generation,
      ),
  }
}
