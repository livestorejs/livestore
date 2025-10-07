import { Effect, ReadonlyRecord, Schema } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import * as otel from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { expect } from 'vitest'

import * as RG from '../reactive.ts'
import { events, makeTodoMvc, tables } from '../utils/tests/fixture.ts'
import { getAllSimplifiedRootSpans, getSimplifiedRootSpan } from '../utils/tests/otel.ts'
import { computed } from './computed.ts'
import { queryDb } from './db-query.ts'

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

      store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))

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
          expect(getSimplifiedRootSpan(exporter, 'createStore', mapAttributes)).toMatchSnapshot()
          expect(getAllSimplifiedRootSpans(exporter, 'LiveStore:commit', mapAttributes)).toMatchSnapshot()
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

      store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))

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
          expect(getSimplifiedRootSpan(exporter, 'createStore', mapAttributes)).toMatchSnapshot()
          expect(getAllSimplifiedRootSpans(exporter, 'LiveStore:commit', mapAttributes)).toMatchSnapshot()
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
      const query$ = queryDb((get) =>
        tables.todos.where(get(filter)).first({ behaviour: 'fallback', fallback: () => defaultTodo }),
      )

      expect(store.query(query$)).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "",
        "text": "",
      }
    `)

      store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))

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
          expect(getSimplifiedRootSpan(exporter, 'createStore', mapAttributes)).toMatchSnapshot()
          expect(getAllSimplifiedRootSpans(exporter, 'LiveStore:commit', mapAttributes)).toMatchSnapshot()
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

      const queryBuilder = tables.todos
        .where({ completed: false })
        .first({ behaviour: 'fallback', fallback: () => defaultTodo })

      const unsubscribe = store.subscribe(queryBuilder, (result) => {
        callbackResults.push(result)
      })

      expect(callbackResults).toHaveLength(1)
      expect(callbackResults[0]).toMatchObject(defaultTodo)

      store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))

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
          expect(getSimplifiedRootSpan(exporter, 'createStore', mapAttributes)).toMatchSnapshot()
          expect(getAllSimplifiedRootSpans(exporter, 'LiveStore:commit', mapAttributes)).toMatchSnapshot()
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

      const queryBuilder = tables.todos
        .where({ completed: false })
        .first({ behaviour: 'fallback', fallback: () => defaultTodo })

      const unsubscribe1 = store.subscribe(queryBuilder, (result) => {
        callbackResults1.push(result)
      })

      const unsubscribe2 = store.subscribe(queryBuilder, (result) => {
        callbackResults2.push(result)
      })

      expect(callbackResults1).toHaveLength(1)
      expect(callbackResults2).toHaveLength(1)

      store.commit(events.todoCreated({ id: 't3', text: 'read book', completed: false }))

      expect(callbackResults1).toHaveLength(2)
      expect(callbackResults2).toHaveLength(2)

      unsubscribe1()

      store.commit(events.todoCreated({ id: 't4', text: 'cook dinner', completed: false }))

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
          expect(getSimplifiedRootSpan(exporter, 'createStore', mapAttributes)).toMatchSnapshot()
          expect(getAllSimplifiedRootSpans(exporter, 'LiveStore:commit', mapAttributes)).toMatchSnapshot()
          await provider.shutdown()
        }),
      ),
    ),
  )

  Vitest.scopedLive('QueryBuilder subscription - direct table subscription', () =>
    Effect.gen(function* () {
      const { store, exporter, span, provider } = yield* makeQuery

      const callbackResults: any[] = []

      const unsubscribe = store.subscribe(tables.todos, (result) => {
        callbackResults.push(result)
      })

      expect(callbackResults).toHaveLength(1)
      expect(callbackResults[0]).toEqual([])

      store.commit(events.todoCreated({ id: 't5', text: 'clean house', completed: true }))

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
          expect(getSimplifiedRootSpan(exporter, 'createStore', mapAttributes)).toMatchSnapshot()
          expect(getAllSimplifiedRootSpans(exporter, 'LiveStore:commit', mapAttributes)).toMatchSnapshot()
          await provider.shutdown()
        }),
      ),
    ),
  )
})
