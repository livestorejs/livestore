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

  Vitest.scopedLive('QueryBuilder subscription - basic functionality', () =>
    Effect.gen(function* () {
      const { store, exporter, span, provider } = yield* makeQuery

      const callbackResults: any[] = []
      const defaultTodo = { id: '', text: '', completed: false }

      const filter = computed(() => ({ completed: false }))
      const queryBuilder = tables.todos.where((get) => get(filter)).first({ fallback: () => defaultTodo })

      const unsubscribe = store.subscribe(queryBuilder, {
        onUpdate: (result) => {
          callbackResults.push(result)
        },
      })

      expect(callbackResults).toHaveLength(1)
      expect(callbackResults[0]).toMatchObject(defaultTodo)

      store.commit(rawSqlEvent({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

      expect(callbackResults).toHaveLength(2)
      expect(callbackResults[1]).toMatchObject({
        id: 't1',
        text: 'buy milk',
        completed: false,
      })

      unsubscribe()
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

  Vitest.scopedLive('QueryBuilder subscription - unsubscribe functionality', () =>
    Effect.gen(function* () {
      const { store, exporter, span, provider } = yield* makeQuery

      const callbackResults1: any[] = []
      const callbackResults2: any[] = []
      const defaultTodo = { id: '', text: '', completed: false }

      const filter = computed(() => ({ completed: false }))
      const queryBuilder = tables.todos.where((get) => get(filter)).first({ fallback: () => defaultTodo })

      const unsubscribe1 = store.subscribe(queryBuilder, {
        onUpdate: (result) => {
          callbackResults1.push(result)
        },
      })

      const unsubscribe2 = store.subscribe(queryBuilder, {
        onUpdate: (result) => {
          callbackResults2.push(result)
        },
      })

      expect(callbackResults1).toHaveLength(1)
      expect(callbackResults2).toHaveLength(1)

      store.commit(rawSqlEvent({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t3', 'read book', 0)` }))

      expect(callbackResults1).toHaveLength(2)
      expect(callbackResults2).toHaveLength(2)

      unsubscribe1()

      store.commit(rawSqlEvent({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t4', 'cook dinner', 0)` }))

      expect(callbackResults1).toHaveLength(2)
      expect(callbackResults2).toHaveLength(3)

      unsubscribe2()
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

  Vitest.scopedLive('QueryBuilder subscription - direct table subscription', () =>
    Effect.gen(function* () {
      const { store, exporter, span, provider } = yield* makeQuery

      const callbackResults: any[] = []

      const unsubscribe = store.subscribe(tables.todos, {
        onUpdate: (result) => {
          callbackResults.push(result)
        },
      })

      expect(callbackResults).toHaveLength(1)
      expect(callbackResults[0]).toEqual([])

      store.commit(rawSqlEvent({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t5', 'clean house', 1)` }))

      expect(callbackResults).toHaveLength(2)
      expect(callbackResults[1]).toHaveLength(1)
      expect(callbackResults[1][0]).toMatchObject({
        id: 't5',
        text: 'clean house',
        completed: true,
      })

      unsubscribe()
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
