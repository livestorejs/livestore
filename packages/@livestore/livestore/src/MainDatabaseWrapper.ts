/* eslint-disable prefer-arrow/prefer-arrow-functions */

import { type InMemoryDatabase, type PreparedStatement, sql } from '@livestore/common'
import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'

import QueryCache from './QueryCache.js'
import BoundMap, { BoundArray } from './utils/bounded-collections.js'
import { getDurationMsFromSpan, getStartTimeHighResFromSpan } from './utils/otel.js'
import { type Bindable, type PreparedBindValues } from './utils/util.js'

export interface DebugInfo {
  slowQueries: BoundArray<SlowQueryInfo>
  queryFrameDuration: number
  queryFrameCount: number
  events: BoundArray<[queryStr: string, bindValues: Bindable | undefined]>
}

export type SlowQueryInfo = [
  queryStr: string,
  bindValues: PreparedBindValues | undefined,
  durationMs: number,
  rowsCount: number | undefined,
  queriedTables: Set<string>,
  startTimePerfNow: DOMHighResTimeStamp,
]

export const emptyDebugInfo = (): DebugInfo => ({
  slowQueries: new BoundArray(200),
  queryFrameDuration: 0,
  queryFrameCount: 0,
  events: new BoundArray(1000),
})

export class MainDatabaseWrapper {
  // TODO: how many unique active statements are expected?
  private cachedStmts = new BoundMap<string, PreparedStatement>(200)
  private tablesUsedCache = new BoundMap<string, Set<string>>(200)
  private resultCache = new QueryCache()
  private db: InMemoryDatabase
  private otelTracer: otel.Tracer
  private otelRootSpanContext: otel.Context
  private tablesUsedStmt
  public debugInfo: DebugInfo = emptyDebugInfo()

  constructor({
    db,
    otelTracer,
    otelRootSpanContext,
  }: {
    db: InMemoryDatabase
    otelTracer: otel.Tracer
    otelRootSpanContext: otel.Context
  }) {
    this.db = db
    this.otelTracer = otelTracer
    this.otelRootSpanContext = otelRootSpanContext

    this.tablesUsedStmt = db.prepare(
      `SELECT tbl_name FROM tables_used(?) AS u JOIN sqlite_master ON sqlite_master.name = u.name WHERE u.schema = 'main';`,
    )

    this.cachedStmts.onEvict = (_queryStr, stmt) => stmt.finalize()

    configureSQLite(this)
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
    // It seems that SQLite doesn't properly handle `DELETE FROM SOME_TABLE` queries without a WHERE clause
    // So we need to handle these queries separately
    const tableNameFromPlainDeleteQuery = tryGetTableNameFromPlainDeleteQuery(query)
    if (tableNameFromPlainDeleteQuery !== undefined) {
      return new Set<string>([tableNameFromPlainDeleteQuery])
    }

    const cached = this.tablesUsedCache.get(query)
    if (cached) {
      return cached
    }
    const stmt = this.tablesUsedStmt
    const tablesUsed = new Set<string>()
    try {
      const results = stmt.select<{ tbl_name: string }>([query] as unknown as PreparedBindValues)

      for (const row of results) {
        tablesUsed.add(row.tbl_name)
      }
    } catch (e) {
      console.error('Error getting tables used', e, 'for query', query)
      return new Set<string>()
    }
    this.tablesUsedCache.set(query, tablesUsed)
    return tablesUsed
  }

  execute(
    query: string,
    bindValues?: PreparedBindValues,
    writeTables?: ReadonlySet<string>,
    options?: { hasNoEffects?: boolean; otelContext?: otel.Context },
  ): { durationMs: number } {
    // console.debug('in-memory-db:execute', query, bindValues)

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

          stmt.execute(bindValues)
        } catch (error) {
          shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify({ query, bindValues })}`)
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
            new Set(),
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
      queriedTables?: Set<string>
      bindValues?: PreparedBindValues
      skipCache?: boolean
      otelContext?: otel.Context
    },
  ): ReadonlyArray<T> {
    const { queriedTables, bindValues, skipCache = false, otelContext } = options ?? {}

    // console.debug('in-memory-db:select', query, bindValues)

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

          const result = stmt.select<T>(bindValues)

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

    return this.db.export()
  }
}

/** Set up SQLite performance; hasn't been super carefully optimized yet. */
const configureSQLite = (db: MainDatabaseWrapper) => {
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

const tryGetTableNameFromPlainDeleteQuery = (query: string) => {
  const [_, tableName] = query.trim().match(/^delete\s+from\s+(\w+)$/i) ?? []
  return tableName
}
