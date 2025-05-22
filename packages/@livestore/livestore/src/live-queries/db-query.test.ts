import { sql } from '@livestore/common'
import { rawSqlEvent } from '@livestore/common/schema'
import { Effect, ReadonlyRecord, Schema } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import * as otel from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { expect } from 'vitest'

import * as RG from '../reactive.js'
import { makeTodoMvc, tables } from '../utils/tests/fixture.js'
import { getSimplifiedRootSpan } from '../utils/tests/otel.js'
import { computed } from './computed.js'
import { queryDb } from './db-query.js'

/*
TODO write tests for:

- sql queries without and with `map` (incl. callback and schemas)
- optional and explicit `queriedTables` argument
*/

Vitest.describe('otel', () => {
  const mapAttributes = (attributes: otel.Attributes) => {
    return ReadonlyRecord.map(attributes, (val, key) => {
      if (key === 'code.stacktrace') {
        return '<STACKTRACE>'
      }
      return val
    })
  }

  const makeQuery = Effect.gen(function* () {
    const exporter = new InMemorySpanExporter()

    RG.__resetIds()

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    const otelTracer = provider.getTracer('test')

    const span = otelTracer.startSpan('test-root')
    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const store = yield* makeTodoMvc({ otelTracer, otelContext })

    return {
      store,
      otelTracer,
      exporter,
      span,
      provider,
    }
  })

  Vitest.scopedLive('otel', () =>
    Effect.gen(function* () {
      const { store, exporter, span, provider } = yield* makeQuery

      const query$ = queryDb({
        query: `select * from todos`,
        schema: Schema.Array(tables.todos.rowSchema),
        queriedTables: new Set(['todos']),
      })
      expect(store.query(query$)).toMatchInlineSnapshot('[]')

      store.commit(rawSqlEvent({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

      expect(store.query(query$)).toMatchInlineSnapshot(`
      [
        {
          "completed": false,
          "id": "t1",
          "text": "buy milk",
        },
      ]
    `)

      span.end()

      return { exporter, provider }
    }).pipe(
      Effect.scoped,
      Effect.tap(({ exporter, provider }) =>
        Effect.promise(async () => {
          await provider.forceFlush()
          expect(getSimplifiedRootSpan(exporter, mapAttributes)).toMatchSnapshot()
          await provider.shutdown()
        }),
      ),
    ),
  )

  Vitest.scopedLive('with thunks', () =>
    Effect.gen(function* () {
      const { store, exporter, span, provider } = yield* makeQuery

      const defaultTodo = { id: '', text: '', completed: false }

      const filter = computed(() => `where completed = 0`, { label: 'where-filter' })
      const query$ = queryDb(
        (get) => ({
          query: `select * from todos ${get(filter)}`,
          schema: Schema.Array(tables.todos.rowSchema).pipe(Schema.headOrElse(() => defaultTodo)),
        }),
        { label: 'all todos' },
      )

      expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

      expect(store.query(query$)).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "",
        "text": "",
      }
    `)

      expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

      store.commit(rawSqlEvent({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

      expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

      expect(store.query(query$)).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "t1",
        "text": "buy milk",
      }
    `)

      expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

      span.end()

      return { exporter, provider }
    }).pipe(
      Effect.scoped,
      Effect.tap(({ exporter, provider }) =>
        Effect.promise(async () => {
          await provider.forceFlush()
          expect(getSimplifiedRootSpan(exporter, mapAttributes)).toMatchSnapshot()
          await provider.shutdown()
        }),
      ),
    ),
  )

  Vitest.scopedLive('with thunks with query builder and without labels', () =>
    Effect.gen(function* () {
      const { store, exporter, span, provider } = yield* makeQuery

      const defaultTodo = { id: '', text: '', completed: false }

      const filter = computed(() => ({ completed: false }))
      const query$ = queryDb((get) => tables.todos.where(get(filter)).first({ fallback: () => defaultTodo }))

      expect(store.query(query$)).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "",
        "text": "",
      }
    `)

      store.commit(rawSqlEvent({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

      expect(store.query(query$)).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "t1",
        "text": "buy milk",
      }
    `)

      span.end()

      return { exporter, provider }
    }).pipe(
      Effect.scoped,
      Effect.tap(({ exporter, provider }) =>
        Effect.promise(async () => {
          await provider.forceFlush()
          expect(getSimplifiedRootSpan(exporter, mapAttributes)).toMatchSnapshot()
          await provider.shutdown()
        }),
      ),
    ),
  )
})
