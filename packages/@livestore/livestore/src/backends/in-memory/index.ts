import type * as otel from '@opentelemetry/api'
import type * as SqliteWasm from 'sqlite-esm'
import sqlite3InitModule from 'sqlite-esm'

import type { ParamsObject } from '../../util.js'
import { prepareBindValues } from '../../util.js'
import { BaseBackend } from '../base.js'
import type { BackendOtelProps, SelectResponse } from '../index.js'

export type BackendOptionsWebInMemory = {
  type: 'web-in-memory'
}

declare type DatabaseWithCAPI = SqliteWasm.Database & { capi: SqliteWasm.CAPI }

// NOTE: This backend is currently only used for testing
export class WebInMemoryBackend extends BaseBackend {
  constructor(
    readonly otelTracer: otel.Tracer,
    readonly db: DatabaseWithCAPI,
  ) {
    super()
  }

  static load = async (_options?: BackendOptionsWebInMemory) => {
    const sqlite3 = await sqlite3InitModule({
      print: (message) => console.log(`[sql-client] ${message}`),
      printErr: (message) => console.error(`[sql-client] ${message}`),
    })
    const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as DatabaseWithCAPI
    db.capi = sqlite3.capi

    return ({ otelTracer }: BackendOtelProps) => new WebInMemoryBackend(otelTracer, db)
  }

  execute = (query: string, bindValues?: ParamsObject): void => {
    this.db.exec({
      sql: query,
      bind: prepareBindValues(bindValues ?? {}, query) as TODO,
      returnValue: 'resultRows',
      rowMode: 'object',
    })
  }

  select = async <T>(query: string, bindValues?: ParamsObject): Promise<SelectResponse<T>> => {
    const resultRows: T[] = []

    this.db.exec({
      sql: query,
      bind: prepareBindValues(bindValues ?? {}, query) as TODO,
      rowMode: 'object',
      resultRows,
      // callback: (row: any) => console.log('select result', db.filename, query, row),
    } as TODO)

    return { results: resultRows }
  }

  getPersistedData = async (): Promise<Uint8Array> => {
    return this.db.capi.sqlite3_js_db_export(this.db.pointer)
  }
}
