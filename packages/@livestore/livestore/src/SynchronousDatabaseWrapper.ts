/* eslint-disable prefer-arrow/prefer-arrow-functions */

import type {
  DebugInfo,
  MutableDebugInfo,
  PreparedBindValues,
  PreparedStatement,
  SynchronousDatabase,
} from '@livestore/common'
import { BoundArray, BoundMap, sql } from '@livestore/common'
import { isDevEnv } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'

import QueryCache from './QueryCache.js'
import { getDurationMsFromSpan, getStartTimeHighResFromSpan } from './utils/otel.js'

export const emptyDebugInfo = (): DebugInfo => ({
  slowQueries: new BoundArray(200),
  queryFrameDuration: 0,
  queryFrameCount: 0,
  events: new BoundArray(1000),
})

export class SynchronousDatabaseWrapper {
  // TODO: how many unique active statements are expected?
  private cachedStmts = new BoundMap<string, PreparedStatement>(200)
  private tablesUsedCache = new BoundMap<string, Set<string>>(200)
  private resultCache = new QueryCache()
  private db: SynchronousDatabase
  private otelTracer: otel.Tracer
  private otelRootSpanContext: otel.Context
  private tablesUsedStmt
  public debugInfo: MutableDebugInfo = emptyDebugInfo()

  constructor({
    db,
    otel,
  }: {
    db: SynchronousDatabase
    otel: {
      tracer: otel.Tracer
      rootSpanContext: otel.Context
    }
  }) {
    this.db = db
    this.otelTracer = otel.tracer
    this.otelRootSpanContext = otel.rootSpanContext

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
    queryStr: string,
    bindValues?: PreparedBindValues,
    writeTables?: ReadonlySet<string>,
    options?: { hasNoEffects?: boolean; otelContext?: otel.Context },
  ): { durationMs: number } {
    // console.debug('in-memory-db:execute', query, bindValues)

    return this.otelTracer.startActiveSpan(
      'livestore.in-memory-db:execute',
      // TODO truncate query string
      { attributes: { 'sql.query': queryStr } },
      options?.otelContext ?? this.otelRootSpanContext,
      (span) => {
        let stmt = this.cachedStmts.get(queryStr)
        if (stmt === undefined) {
          stmt = this.db.prepare(queryStr)
          this.cachedStmts.set(queryStr, stmt)
        }

        stmt.execute(bindValues)

        if (options?.hasNoEffects !== true && !this.resultCache.ignoreQuery(queryStr)) {
          // TODO use write tables instead
          // check what queries actually end up here.
          this.resultCache.invalidate(writeTables ?? this.getTablesUsed(queryStr))
        }

        span.end()

        const durationMs = getDurationMsFromSpan(span)

        this.debugInfo.queryFrameDuration += durationMs
        this.debugInfo.queryFrameCount++

        if (durationMs > 5 && isDevEnv()) {
          this.debugInfo.slowQueries.push({
            queryStr,
            bindValues,
            durationMs,
            rowsCount: undefined,
            queriedTables: new Set(),
            startTimePerfNow: getStartTimeHighResFromSpan(span),
          })
        }

        return { durationMs }
      },
    )
  }

  select<T = any>(
    queryStr: string,
    options?: {
      queriedTables?: ReadonlySet<string>
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
          span.setAttribute('sql.query', queryStr)

          const key = this.resultCache.getKey(queryStr, bindValues)
          const cachedResult = this.resultCache.get(key)
          if (skipCache === false && cachedResult !== undefined) {
            span.setAttribute('sql.rowsCount', cachedResult.length)
            span.setAttribute('sql.cached', true)
            span.end()
            return cachedResult
          }

          let stmt = this.cachedStmts.get(queryStr)
          if (stmt === undefined) {
            stmt = this.db.prepare(queryStr)
            this.cachedStmts.set(queryStr, stmt)
          }

          const result = stmt.select<T>(bindValues)

          span.setAttribute('sql.rowsCount', result.length)
          span.setAttribute('sql.cached', false)

          const queriedTables_ = queriedTables ?? this.getTablesUsed(queryStr)
          this.resultCache.set(queriedTables_, key, result)

          span.end()

          const durationMs = getDurationMsFromSpan(span)

          this.debugInfo.queryFrameDuration += durationMs
          this.debugInfo.queryFrameCount++

          // TODO also enable in non-dev mode
          if (durationMs > 5 && isDevEnv()) {
            this.debugInfo.slowQueries.push({
              queryStr,
              bindValues,
              durationMs,
              rowsCount: result.length,
              queriedTables: queriedTables_,
              startTimePerfNow: getStartTimeHighResFromSpan(span),
            })
          }

          return result
        } finally {
          span.end()
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
const configureSQLite = (db: SynchronousDatabaseWrapper) => {
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
