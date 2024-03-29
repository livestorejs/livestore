import type { DatabaseImpl, StorageDatabase } from '@livestore/common'
import { getExecArgsFromMutation, initializeSingletonTables, migrateDb } from '@livestore/common'
import { type LiveStoreSchema } from '@livestore/common/schema'
import type * as Sqlite from '@livestore/sqlite-wasm'
import { makeNoopSpan, shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeMainDb } from './make-main-db.js'
import { InMemoryStorage } from './storage/in-memory/index.js'
import type { StorageInit } from './storage/index.js'

export const rehydrateFromMutationLog = async ({
  storageDbRef,
  sqlite3,
  schema,
  otelTracer,
  otelContext,
  loadStorage,
}: {
  storageDbRef: { current: StorageDatabase }
  sqlite3: Sqlite.Sqlite3Static
  schema: LiveStoreSchema
  otelTracer: otel.Tracer
  otelContext: otel.Context
  loadStorage?: () => StorageInit | Promise<StorageInit>
}): Promise<Uint8Array> => {
  const mutationLogData = await storageDbRef.current.getMutationLogData()

  if (mutationLogData.length > 0) {
    try {
      const mutationLogDb = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as Sqlite.Database & {
        capi: Sqlite.CAPI
      }
      mutationLogDb.capi = sqlite3.capi

      // Based on https://sqlite.org/forum/forumpost/2119230da8ac5357a13b731f462dc76e08621a4a29724f7906d5f35bb8508465
      // TODO find cleaner way to do this once possible in sqlite3-wasm
      const bytes = mutationLogData
      const p = sqlite3.wasm.allocFromTypedArray(bytes)
      const _rc = sqlite3.capi.sqlite3_deserialize(
        mutationLogDb.pointer!,
        'main',
        p,
        bytes.length,
        bytes.length,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE && sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      )

      const stmt = mutationLogDb.prepare('SELECT * FROM mutation_log ORDER BY id ASC')

      type MutationLogRow = {
        id: string
        mutation: string
        args_json: string
        schema_hash: number
        created_at: string
      }
      const results: MutationLogRow[] = []

      try {
        // NOTE `getColumnNames` only works for `SELECT` statements, ignoring other statements for now
        let columns = undefined
        try {
          columns = stmt.getColumnNames()
        } catch (_e) {}

        while (stmt.step()) {
          if (columns !== undefined) {
            const obj: { [key: string]: any } = {}
            for (const [i, c] of columns.entries()) {
              obj[c] = stmt.get(i)
            }
            results.push(obj as unknown as MutationLogRow)
          }
        }
      } finally {
        // reset the cached statement so we can use it again in the future
        stmt.reset()
      }

      const newDb = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as Sqlite.Database & {
        capi: Sqlite.CAPI
      }
      newDb.capi = sqlite3.capi
      const parentSpan = otel.trace.getSpan(otel.context.active()) ?? makeNoopSpan()
      const storageDb_ = await InMemoryStorage.load()({ otel: { otelTracer, parentSpan }, data: undefined })
      // NOTE We're just using a `dbImpl` here with a in-memory storage DB since we're relying on it for the migration function
      // TODO refactor this
      const dbImpl = { mainDb: makeMainDb(sqlite3, newDb), storageDb: storageDb_ } satisfies DatabaseImpl

      migrateDb({ db: dbImpl, otelContext, schema })

      initializeSingletonTables(schema, dbImpl)

      // console.log('results', results)

      console.time('reapply-mutations')

      for (const row of results) {
        const mutationDef = schema.mutations.get(row.mutation) ?? shouldNeverHappen(`Unknown mutation ${row.mutation}`)

        if (Schema.hash(mutationDef.schema) !== row.schema_hash) {
          throw new Error(`Schema hash mismatch for mutation ${row.mutation}`)
        }

        const argsDecoded = Schema.decodeUnknownSync(Schema.parseJson(mutationDef.schema))(row.args_json)
        const mutationEventDecoded = {
          id: row.id,
          mutation: row.mutation,
          args: argsDecoded,
        }
        // const argsEncoded = JSON.parse(row.args_json)
        // const mutationSqlRes =
        //   typeof mutation.sql === 'string'
        //     ? mutation.sql
        //     : mutation.sql(Schema.decodeUnknownSync(mutation.schema)(argsEncoded))
        // const mutationSql = typeof mutationSqlRes === 'string' ? mutationSqlRes : mutationSqlRes.sql
        // const bindValues = typeof mutationSqlRes === 'string' ? argsEncoded : mutationSqlRes.bindValues

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        for (const { statementSql, bindValues } of execArgsArr) {
          try {
            dbImpl.mainDb.execute(statementSql, bindValues)
            // console.log(`Re-executed mutation ${mutationSql}`, bindValues)
          } catch (e) {
            console.error(`Error executing migration for mutation ${statementSql}`, bindValues, e)
            debugger
            throw e
          }
        }
      }

      console.timeEnd('reapply-mutations')

      console.time('reboot')

      const rehydratedData = newDb.capi.sqlite3_js_db_export(newDb.pointer!)

      newDb.close()

      await storageDbRef.current.shutdown()

      storageDbRef.current = await otelTracer.startActiveSpan('storage:load', {}, otelContext, async (span) => {
        try {
          const init = loadStorage ? await loadStorage() : InMemoryStorage.load()
          const parentSpan = otel.trace.getSpan(otel.context.active()) ?? makeNoopSpan()
          return init({ otel: { otelTracer, parentSpan }, data: rehydratedData.slice() })
        } finally {
          span.end()
        }
      })

      console.timeEnd('reboot')

      return rehydratedData
    } catch (e) {
      console.error('Error while rehydrating database from mutation log', e)
      debugger
      throw e
    }
  } else {
    return new Uint8Array()
  }
}
