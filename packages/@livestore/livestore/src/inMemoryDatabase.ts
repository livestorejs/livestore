/* eslint-disable prefer-arrow/prefer-arrow-functions */

import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import type * as SqliteWasm from 'sqlite-esm'

import BoundMap, { BoundArray } from './bounded-collections.js'
// import { EVENTS_TABLE_NAME } from './events.js'
import { sql } from './index.js'
import { getDurationMsFromSpan, getStartTimeHighResFromSpan } from './otel.js'
import QueryCache from './QueryCache.js'
import type { Bindable, ParamsObject } from './util.js'
import { prepareBindValues } from './util.js'

export enum IndexType {
  Basic = 'Basic',
  FullText = 'FullText',
}

export interface Index {
  indexType: IndexType
  name: string
  columns: string[]
}

declare type DatabaseWithCAPI = SqliteWasm.Database & { capi: SqliteWasm.CAPI }

export interface DebugInfo {
  slowQueries: BoundArray<SlowQueryInfo>
  queryFrameDuration: number
  queryFrameCount: number
  events: BoundArray<[queryStr: string, bindValues: Bindable | undefined]>
}

export type SlowQueryInfo = [
  queryStr: string,
  bindValues: Bindable | undefined,
  durationMs: number,
  rowsCount: number | undefined,
  queriedTables: string[],
  startTimePerfNow: DOMHighResTimeStamp,
]

export const emptyDebugInfo = (): DebugInfo => ({
  slowQueries: new BoundArray(200),
  queryFrameDuration: 0,
  queryFrameCount: 0,
  events: new BoundArray(1000),
})

export class InMemoryDatabase {
  // TODO: how many unique active statements are expected?
  private cachedStmts = new BoundMap<string, SqliteWasm.PreparedStatement>(200)
  private tablesUsedCache = new BoundMap<string, string[]>(200)
  private resultCache = new QueryCache()
  public debugInfo: DebugInfo = emptyDebugInfo()

  constructor(
    private db: DatabaseWithCAPI,
    private otelTracer: otel.Tracer,
    private otelRootSpanContext: otel.Context,
    public SQL: SqliteWasm.Sqlite3Static,
  ) {}

  static async load(
    data: Uint8Array | undefined,
    otelTracer: otel.Tracer,
    otelRootSpanContext: otel.Context,
    sqlite3: SqliteWasm.Sqlite3Static,
  ): Promise<InMemoryDatabase> {
    // TODO move WASM init higher up in the init process (to do some other work while it's loading)

    const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as DatabaseWithCAPI
    db.capi = sqlite3.capi

    if (data !== undefined) {
      // Based on https://sqlite.org/forum/forumpost/2119230da8ac5357a13b731f462dc76e08621a4a29724f7906d5f35bb8508465
      // TODO find cleaner way to do this once possible in sqlite3-wasm
      const bytes = data
      const p = sqlite3.wasm.allocFromTypedArray(bytes)
      const _rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer,
        'main',
        p,
        bytes.length,
        bytes.length,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE && sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      )
    }

    const inMemoryDatabase = new InMemoryDatabase(db, otelTracer, otelRootSpanContext, sqlite3)

    configureSQLite(inMemoryDatabase)

    return inMemoryDatabase
  }

  txn<TRes>(callback: () => TRes): TRes {
    this.execute(sql`begin transaction;`)
    let errored = false
    let result: TRes

    try {
      result = callback()
    } catch (e) {
      errored = true
      this.execute(sql`rollback;`)
      throw e
    }

    if (!errored) {
      this.execute(sql`commit;`)
    }

    return result
  }

  getTablesUsed(query: string) {
    const cached = this.tablesUsedCache.get(query)
    if (cached) {
      return cached
    }
    const stmt = this.db.prepare(
      `SELECT tbl_name FROM tables_used(?) AS u JOIN sqlite_master ON sqlite_master.name = u.name WHERE u.schema = 'main';`,
    )
    const tablesUsed = []
    try {
      stmt.bind([query])
      while (stmt.step()) {
        tablesUsed.push(stmt.get(0))
      }
    } finally {
      stmt.finalize()
    }
    this.tablesUsedCache.set(query, tablesUsed as string[])
    return tablesUsed as string[]
  }

  execute(
    query: string,
    bindValues?: ParamsObject,
    writeTables?: string[],
    options?: { hasNoEffects?: boolean; otelContext: otel.Context },
  ): { durationMs: number } {
    return this.otelTracer.startActiveSpan(
      'livestore.in-memory-db:execute',
      // TODO truncate query string
      { attributes: { 'sql.query': query } },
      options?.otelContext ?? this.otelRootSpanContext,
      (span) => {
        try {
          let stmt = this.cachedStmts.get(query)
          if (stmt === undefined) {
            stmt = this.db.prepare(query)
            this.cachedStmts.set(query, stmt)
          }

          // TODO check whether we can remove the extra `prepareBindValues` call here (e.g. enforce proper type in API)
          if (bindValues !== undefined && Object.keys(bindValues).length > 0) {
            stmt.bind(prepareBindValues(bindValues, query))
          }

          if (import.meta.env.DEV) {
            this.debugInfo.events.push([query, bindValues])
          }

          try {
            stmt.step()
          } finally {
            stmt.reset() // Reset is needed for next execution
          }
        } catch (error) {
          shouldNeverHappen(
            `Error executing query: ${error} \n ${JSON.stringify({
              query,
              bindValues,
            })}`,
          )
        }

        if (options?.hasNoEffects !== true && !this.resultCache.ignoreQuery(query)) {
          // TODO use write tables instead
          // check what queries actually end up here.
          this.resultCache.invalidate(writeTables ?? this.getTablesUsed(query))
        }

        span.end()

        const durationMs = getDurationMsFromSpan(span)

        this.debugInfo.queryFrameDuration += durationMs
        this.debugInfo.queryFrameCount++

        if (durationMs > 5 && import.meta.env.DEV) {
          this.debugInfo.slowQueries.push([
            query,
            bindValues,
            durationMs,
            undefined,
            [],
            getStartTimeHighResFromSpan(span),
          ])
        }

        return { durationMs }
      },
    )
  }

  select<T = any>(
    query: string,
    options?: {
      queriedTables?: string[]
      bindValues?: Bindable
      skipCache?: boolean
      otelContext?: otel.Context
    },
  ): ReadonlyArray<T> {
    const { queriedTables, bindValues, skipCache = false, otelContext } = options ?? {}
    return this.otelTracer.startActiveSpan(
      'sql-in-memory-select',
      {},
      otelContext ?? this.otelRootSpanContext,
      (span) => {
        try {
          span.setAttribute('sql.query', query)

          const key = this.resultCache.getKey(query, bindValues)
          const cachedResult = this.resultCache.get(key)
          if (skipCache === false && cachedResult !== undefined) {
            span.setAttribute('sql.rowsCount', cachedResult.length)
            span.setAttribute('sql.cached', true)
            span.end()
            return cachedResult
          }

          let stmt = this.cachedStmts.get(query)
          if (stmt === undefined) {
            stmt = this.db.prepare(query)
            this.cachedStmts.set(query, stmt)
          }
          if (bindValues) {
            stmt.bind(bindValues ?? {})
          }

          const result: T[] = []
          try {
            const columns = stmt.getColumnNames()
            while (stmt.step()) {
              const obj: { [key: string]: any } = {}
              for (const [i, c] of columns.entries()) {
                obj[c] = stmt.get(i)
              }
              result.push(obj as unknown as T)
            }
          } finally {
            // we're caching statements in this iteration. do not free.
            // stmt.free();
            // reset the cached statement so we can use it again in the future
            stmt.reset()
          }

          span.setAttribute('sql.rowsCount', result.length)
          span.setAttribute('sql.cached', false)

          const queriedTables_ = queriedTables ?? this.getTablesUsed(query)
          this.resultCache.set(queriedTables_, key, result)

          span.end()

          const durationMs = getDurationMsFromSpan(span)

          this.debugInfo.queryFrameDuration += durationMs
          this.debugInfo.queryFrameCount++

          // TODO also enable in non-dev mode
          if (durationMs > 5 && import.meta.env.DEV) {
            this.debugInfo.slowQueries.push([
              query,
              bindValues,
              durationMs,
              result.length,
              queriedTables_,
              getStartTimeHighResFromSpan(span),
            ])
          }

          return result
        } catch (e) {
          span.end()
          console.error(query)
          console.error(bindValues)
          shouldNeverHappen(`Error executing select query: ${e} \n ${JSON.stringify({ query, bindValues })}`)
        }
      },
    )
  }

  export() {
    // Clear statement cache because exporting frees statements
    for (const key of this.cachedStmts.keys()) {
      this.cachedStmts.delete(key)
    }

    return this.db.capi.sqlite3_js_db_export(this.db.pointer)
  }
}

/** Set up SQLite performance; hasn't been super carefully optimized yet. */
const configureSQLite = (db: InMemoryDatabase) => {
  db.execute(
    // TODO: revisit these tuning parameters for max performance
    sql`
      PRAGMA page_size=32768;
      PRAGMA cache_size=10000;
      PRAGMA journal_mode='MEMORY'; -- we don't flush to disk before committing a write
      PRAGMA synchronous='OFF';
      PRAGMA temp_store='MEMORY';
      PRAGMA foreign_keys='ON'; -- we want foreign key constraints to be enforced
    `,
  )
}
