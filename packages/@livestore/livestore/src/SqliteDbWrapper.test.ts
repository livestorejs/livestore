import * as otel from '@opentelemetry/api'
import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'

import { StoreInternalsSymbol } from './store/store-types.ts'
import { makeTodoMvc } from './utils/tests/fixture.ts'

Vitest.describe('SqliteDbWrapper', () => {
  Vitest.live('works with the OpenTelemetry API no-op tracer', (_test) =>
    Effect.gen(function* () {
      const otelTracer = otel.trace.getTracer('sqlite-wrapper-noop-test')
      const probeSpan = otelTracer.startSpan('verify-noop-tracer')
      expect(probeSpan.isRecording()).toBe(false)
      probeSpan.end()

      // Store creation exercises the configureSQLite execute path.
      const store = yield* makeTodoMvc({ otelTracer })
      const sqliteDbWrapper = store[StoreInternalsSymbol].sqliteDbWrapper
      const { durationMs } = sqliteDbWrapper.cachedExecute('CREATE TABLE noop_timing_test (id INTEGER)', undefined, {
        hasNoEffects: true,
      })

      expect(sqliteDbWrapper.select('SELECT 1 AS value')).toEqual([{ value: 1 }])
      expect(sqliteDbWrapper.debugInfo.queryFrameCount).toBeGreaterThan(0)
      expect(sqliteDbWrapper.debugInfo.queryFrameDuration).toBeGreaterThanOrEqual(0)
      expect(durationMs).toBeGreaterThanOrEqual(0)
    }),
  )

  Vitest.describe('getTablesUsed', () => {
    const getTablesUsed = (query: string) =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        return store[StoreInternalsSymbol].sqliteDbWrapper.getTablesUsed(query)
      })

    Vitest.live('should return the correct tables used', (_test) =>
      Effect.gen(function* () {
        const tablesUsed = yield* getTablesUsed('select * from todos')
        expect(tablesUsed).toEqual(new Set(['todos']))
      }),
    )

    Vitest.live('should handle DELETE FROM statement without WHERE clause', (_test) =>
      Effect.gen(function* () {
        const tablesUsed = yield* getTablesUsed('DELETE FROM todos')
        expect(tablesUsed).toEqual(new Set(['todos']))
      }),
    )

    Vitest.live('should handle INSERT with ON CONFLICT clause', (_test) =>
      Effect.gen(function* () {
        const tablesUsed = yield* getTablesUsed(
          'INSERT INTO todos (id, text, completed) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?',
        )
        expect(tablesUsed).toEqual(new Set(['todos']))
      }),
    )
  })
})
