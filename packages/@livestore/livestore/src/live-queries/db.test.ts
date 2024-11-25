import { Effect, Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it } from 'vitest'

import { computed, queryDb, rawSqlMutation, sql } from '../index.js'
import { makeTodoMvc, tables } from '../utils/tests/fixture.js'
import { getSimplifiedRootSpan } from '../utils/tests/otel.js'

/*
TODO write tests for:

- sql queries without and with `map` (incl. callback and schemas)
- optional and explicit `queriedTables` argument
*/

describe('otel', () => {
  let cachedProvider: BasicTracerProvider | undefined

  const makeQuery = Effect.gen(function* () {
    const exporter = new InMemorySpanExporter()

    const provider = cachedProvider ?? new BasicTracerProvider()
    cachedProvider = provider
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    provider.register()

    const otelTracer = otel.trace.getTracer('test')

    const span = otelTracer.startSpan('test')
    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const { store } = yield* makeTodoMvc({ otelTracer, otelContext })

    return {
      store,
      otelTracer,
      exporter,
      span,
      provider,
    }
  })

  it('otel', async () => {
    const { exporter } = await Effect.gen(function* () {
      const { store, exporter, span } = yield* makeQuery

      const query$ = queryDb({
        query: `select * from todos`,
        schema: Schema.Array(tables.todos.schema),
        queriedTables: new Set(['todos']),
      })
      expect(query$.run()).toMatchInlineSnapshot('[]')

      store.mutate(rawSqlMutation({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

      expect(query$.run()).toMatchInlineSnapshot(`
      [
        {
          "completed": false,
          "id": "t1",
          "text": "buy milk",
        },
      ]
    `)

      query$.destroy()
      span.end()

      return { exporter }
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise)

    expect(getSimplifiedRootSpan(exporter)).toMatchSnapshot()
  })

  it('with thunks', async () => {
    const { exporter } = await Effect.gen(function* () {
      const { store, exporter, span } = yield* makeQuery

      const defaultTodo = { id: '', text: '', completed: false }

      const filter = computed(() => `where completed = 0`, { label: 'where-filter' })
      const query$ = queryDb(
        (get) => ({
          query: `select * from todos ${get(filter)}`,
          schema: Schema.Array(tables.todos.schema).pipe(Schema.headOrElse(() => defaultTodo)),
        }),
        { label: 'all todos' },
      )

      expect(query$.run()).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "",
        "text": "",
      }
    `)

      store.mutate(rawSqlMutation({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

      expect(query$.run()).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "t1",
        "text": "buy milk",
      }
    `)

      query$.destroy()
      span.end()

      return { exporter }
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise)

    expect(getSimplifiedRootSpan(exporter)).toMatchSnapshot()
  })

  it('with thunks with query builder and without labels', async () => {
    const { exporter } = await Effect.gen(function* () {
      const { store, exporter, span } = yield* makeQuery

      const defaultTodo = { id: '', text: '', completed: false }

      const filter = computed(() => ({ completed: false }))
      const query$ = queryDb((get) => tables.todos.query.where(get(filter)).first({ fallback: () => defaultTodo }))

      expect(query$.run()).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "",
        "text": "",
      }
    `)

      store.mutate(rawSqlMutation({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

      expect(query$.run()).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "t1",
        "text": "buy milk",
      }
    `)

      query$.destroy()
      span.end()

      return { exporter }
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise)

    expect(getSimplifiedRootSpan(exporter)).toMatchSnapshot()
  })
})
