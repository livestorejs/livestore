import { initializeSingletonTables, migrateDb, type PreparedBindValues, type StorageDatabase } from '@livestore/common'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import type * as SqliteWasm from '@livestore/sqlite-wasm'
import sqlite3InitModule from '@livestore/sqlite-wasm'
import { Effect } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import { makeMainDb } from '../../make-main-db.js'
import type { StorageInit } from '../utils/types.js'
import { configureConnection } from '../web-worker/common.js'

const sqlite3Promise = sqlite3InitModule({
  print: (message) => console.log(`[sql-client] ${message}`),
  printErr: (message) => console.error(`[sql-client] ${message}`),
})

/** NOTE: This storage is currently only used for testing */
export class InMemoryStorage implements StorageDatabase {
  filename = ':memory:'

  constructor(
    readonly otelTracer: otel.Tracer,
    readonly schema: LiveStoreSchema,
  ) {}

  static load =
    (): StorageInit =>
    ({ otel, schema }) =>
      new InMemoryStorage(otel.otelTracer, schema)

  execute = async (_query: string, _bindValues?: PreparedBindValues) => {}

  mutate = async (_mutationEventEncoded: MutationEvent.Any, _parentSpan?: otel.Span | undefined) => {}

  export = async () => undefined

  getInitialSnapshot = () =>
    Effect.gen(this, function* ($) {
      const sqlite3 = yield* $(Effect.tryPromise(() => sqlite3Promise))

      const otelContext = otel.context.active()
      const schema = this.schema

      const tmpDb = new sqlite3.oo1.DB({}) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
      tmpDb.capi = sqlite3.capi
      configureConnection(tmpDb, { fkEnabled: true })
      const tmpMainDb = makeMainDb(sqlite3, tmpDb)

      migrateDb({ db: tmpMainDb, otelContext, schema })

      initializeSingletonTables(schema, tmpMainDb)

      return tmpMainDb.export()
    }).pipe(Effect.runPromise)

  getMutationLogData = async () => new Uint8Array()

  dangerouslyReset = async () => {}
  shutdown = async () => {}
}
