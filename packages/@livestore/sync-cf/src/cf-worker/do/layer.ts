import { UnexpectedError } from '@livestore/common'
import { EventSequenceNumber, State } from '@livestore/common/schema'
import type { CfTypes } from '@livestore/common-cf'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Predicate } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import type { Env, MakeDurableObjectClassOptions, RpcSubscription } from '../shared.ts'
import { contextTable, eventlogTable } from './sqlite.ts'
import { makeStorage } from './sync-storage.ts'

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
        if (Predicate.hasProperty(from, 'url')) {
          const url = new URL(from.url)
          return (
            url.searchParams.get('storeId') ?? shouldNeverHappen(`No storeId provided in request URL search params`)
          )
        }
        return from.storeId
      }

      const storeId = getStoreId(from)
      const storage = makeStorage(doSelf.ctx, doSelf.env, storeId)

      // Initialize database tables
      {
        const colSpec = State.SQLite.makeColumnSpec(eventlogTable.sqliteDef.ast)
        // D1 database is async, so we need to use a promise
        yield* Effect.promise(() =>
          doSelf.env.DB.exec(`CREATE TABLE IF NOT EXISTS "${storage.dbName}" (${colSpec}) strict`),
        )
      }
      {
        const colSpec = State.SQLite.makeColumnSpec(contextTable.sqliteDef.ast)
        doSelf.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS "${contextTable.sqliteDef.name}" (${colSpec}) strict`)
      }

      const storageRow = doSelf.ctx.storage.sql
        .exec(`SELECT * FROM "${contextTable.sqliteDef.name}" WHERE storeId = ?`, storeId)
        .toArray()[0] as typeof contextTable.rowSchema.Type | undefined

      const currentHeadRef = { current: storageRow?.currentHead ?? EventSequenceNumber.ROOT.global }

      // TODO do concistency check with eventlog table to make sure the head is consistent

      // Should be the same backendId for lifetime of the durable object
      const backendId = storageRow?.backendId ?? nanoid()

      const updateCurrentHead = (currentHead: EventSequenceNumber.GlobalEventSequenceNumber) => {
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

      const rpcSubscriptions = new Map<string, RpcSubscription>()

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
        updateCurrentHead(EventSequenceNumber.ROOT.global)
      }

      return storageCache
    },
    UnexpectedError.mapToUnexpectedError,
    Effect.withSpan('@livestore/sync-cf:durable-object:makeDoCtx'),
  ),
}) {}
