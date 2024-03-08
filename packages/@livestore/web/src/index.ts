import { type DatabaseFactory, type DatabaseImpl, type MainDatabase, type PreparedBindValues } from '@livestore/common'
import type * as Sqlite from '@livestore/sqlite-wasm'
import initSqlite3Wasm from '@livestore/sqlite-wasm'
import { makeNoopSpan } from '@livestore/utils'
import * as otel from '@opentelemetry/api'

import { InMemoryStorage } from './storage/in-memory/index.js'
import type { StorageInit } from './storage/index.js'

// NOTE we're starting to initialize the sqlite wasm binary here (already before calling `createStore`),
const sqlite3Promise = initSqlite3Wasm({
  print: (message) => console.log(`[livestore sqlite] ${message}`),
  printErr: (message) => console.error(`[livestore sqlite] ${message}`),
})

export const makeDb =
  (loadStorage?: () => StorageInit | Promise<StorageInit>): DatabaseFactory =>
  async ({ otelTracer, otelContext }) => {
    const sqlite3 = await sqlite3Promise

    const storageDb = await otelTracer.startActiveSpan('storage:load', {}, otelContext, async (span) => {
      try {
        const init = loadStorage ? await loadStorage() : InMemoryStorage.load()
        const parentSpan = otel.trace.getSpan(otel.context.active()) ?? makeNoopSpan()
        return init({ otelTracer, parentSpan })
      } finally {
        span.end()
      }
    })

    const persistedData = await otelTracer.startActiveSpan(
      'storage:getPersistedData',
      {},
      otelContext,
      async (span) => {
        try {
          const data = await storageDb.export(span)
          // NOTE we're always returning a Uint8Array here, to make sure th `sqlite3` object is always
          // re-initialized with an empty database (e.g. during tests)
          return data ?? new Uint8Array()
        } finally {
          span.end()
        }
      },
    )

    let db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as Sqlite.Database & { capi: Sqlite.CAPI }
    db.capi = sqlite3.capi

    // Based on https://sqlite.org/forum/forumpost/2119230da8ac5357a13b731f462dc76e08621a4a29724f7906d5f35bb8508465
    // TODO find cleaner way to do this once possible in sqlite3-wasm
    const bytes = persistedData
    const p = sqlite3.wasm.allocFromTypedArray(bytes)
    const _rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer!,
      'main',
      p,
      bytes.length,
      bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE && sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    )

    const mainDb = {
      filename: ':memory:',
      prepare: (queryStr) => {
        const stmt = db.prepare(queryStr)

        return {
          execute: (bindValues) => {
            if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
              stmt.bind(bindValues)
            }

            try {
              stmt.step()
            } finally {
              stmt.reset() // Reset is needed for next execution
            }

            // if (storage !== undefined) {
            //   const parentSpan = otel.trace.getSpan(otel.context.active())
            //   storage.execute(queryStr, bindValues, parentSpan)
            // }
          },
          select: <T>(bindValues: PreparedBindValues) => {
            if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
              stmt.bind(bindValues)
            }

            const results: T[] = []

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
                  results.push(obj as unknown as T)
                }
              }
            } finally {
              // reset the cached statement so we can use it again in the future
              stmt.reset()
            }

            return results
          },
          finalize: () => stmt.finalize(),
        }
      },
      export: () => db.capi.sqlite3_js_db_export(db.pointer!),
      execute: (queryStr, bindValues) => {
        const stmt = db.prepare(queryStr)

        if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
          stmt.bind(bindValues)
        }

        try {
          stmt.step()
        } finally {
          stmt.finalize()
        }
      },
      dangerouslyReset: async () => {
        db.capi.sqlite3_close_v2(db.pointer!)

        db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as Sqlite.Database & { capi: Sqlite.CAPI }
      },
    } satisfies MainDatabase

    return {
      mainDb,
      storageDb,
    } satisfies DatabaseImpl
  }
