import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it } from 'vitest'

import { makeTodoMvc, tables } from '../__tests__/react/fixture.js'
import { getSimplifiedRootSpan } from '../__tests__/react/utils/otel.js'
import { computed, querySQL, rawSqlMutation, sql } from '../index.js'

/*
TODO write tests for:

- sql queries without and with `map` (incl. callback and schemas)
- optional and explicit `queriedTables` argument
*/

describe('otel', () => {
  let cachedProvider: BasicTracerProvider | undefined

  const makeQuery = async () => {
    const exporter = new InMemorySpanExporter()

    const provider = cachedProvider ?? new BasicTracerProvider()
    cachedProvider = provider
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    provider.register()

    const otelTracer = otel.trace.getTracer('test')

    const span = otelTracer.startSpan('test')
    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const { store } = await makeTodoMvc({ otelTracer, otelContext })

    return {
      [Symbol.dispose]: () => store.destroy(),
      store,
      otelTracer,
      exporter,
      span,
      provider,
    }
  }

  it('otel', async () => {
    using inputs = await makeQuery()
    const { store, exporter, span } = inputs

    const query = querySQL(`select * from todos`, {
      schema: Schema.Array(tables.todos.schema),
      queriedTables: new Set(['todos']),
    })
    expect(query.run()).toMatchInlineSnapshot('[]')

    store.mutate(rawSqlMutation({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

    expect(query.run()).toMatchInlineSnapshot(`
      [
        {
          "completed": false,
          "id": "t1",
          "text": "buy milk",
        },
      ]
    `)

    await store.destroy()
    query.destroy()
    span.end()

    expect(getSimplifiedRootSpan(exporter)).toMatchInlineSnapshot(`
      {
        "_name": "test",
        "children": [
          {
            "_name": "livestore.in-memory-db:execute",
            "attributes": {
              "sql.query": "
            PRAGMA page_size=32768;
            PRAGMA cache_size=10000;
            PRAGMA journal_mode='MEMORY'; -- we don't flush to disk before committing a write
            PRAGMA synchronous='OFF';
            PRAGMA temp_store='MEMORY';
            PRAGMA foreign_keys='ON'; -- we want foreign key constraints to be enforced
          ",
            },
          },
          {
            "_name": "LiveStore:mutations",
            "children": [
              {
                "_name": "LiveStore:mutate",
                "attributes": {
                  "livestore.mutateLabel": "mutate",
                },
                "children": [
                  {
                    "_name": "LiveStore:processWrites",
                    "attributes": {
                      "livestore.mutateLabel": "mutate",
                    },
                    "children": [
                      {
                        "_name": "LiveStore:mutatetWithoutRefresh",
                        "attributes": {
                          "livestore.args": "{
        "sql": "INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)"
      }",
                          "livestore.mutation": "livestore.RawSql",
                        },
                        "children": [
                          {
                            "_name": "livestore.in-memory-db:execute",
                            "attributes": {
                              "sql.query": "INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            "_name": "LiveStore:queries",
            "children": [
              {
                "_name": "sql:select * from todos",
                "attributes": {
                  "sql.query": "select * from todos",
                  "sql.rowsCount": 0,
                },
                "children": [
                  {
                    "_name": "sql-in-memory-select",
                    "attributes": {
                      "sql.cached": false,
                      "sql.query": "select * from todos",
                      "sql.rowsCount": 0,
                    },
                  },
                ],
              },
              {
                "_name": "sql:select * from todos",
                "attributes": {
                  "sql.query": "select * from todos",
                  "sql.rowsCount": 1,
                },
                "children": [
                  {
                    "_name": "sql-in-memory-select",
                    "attributes": {
                      "sql.cached": false,
                      "sql.query": "select * from todos",
                      "sql.rowsCount": 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
      }
    `)
  })

  it('with thunks', async () => {
    using inputs = await makeQuery()
    const { store, exporter, span } = inputs

    const defaultTodo = { id: '', text: '', completed: false }

    const filter = computed(() => `where completed = 0`, { label: 'where-filter' })
    const query = querySQL((get) => `select * from todos ${get(filter)}`, {
      label: 'all todos',
      schema: Schema.Array(tables.todos.schema).pipe(Schema.headOrElse(() => defaultTodo)),
    })

    expect(query.run()).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "",
        "text": "",
      }
    `)

    store.mutate(rawSqlMutation({ sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)` }))

    expect(query.run()).toMatchInlineSnapshot(`
      {
        "completed": false,
        "id": "t1",
        "text": "buy milk",
      }
    `)

    await store.destroy()
    query.destroy()
    span.end()

    expect(getSimplifiedRootSpan(exporter)).toMatchInlineSnapshot(`
      {
        "_name": "test",
        "children": [
          {
            "_name": "livestore.in-memory-db:execute",
            "attributes": {
              "sql.query": "
            PRAGMA page_size=32768;
            PRAGMA cache_size=10000;
            PRAGMA journal_mode='MEMORY'; -- we don't flush to disk before committing a write
            PRAGMA synchronous='OFF';
            PRAGMA temp_store='MEMORY';
            PRAGMA foreign_keys='ON'; -- we want foreign key constraints to be enforced
          ",
            },
          },
          {
            "_name": "LiveStore:mutations",
            "children": [
              {
                "_name": "LiveStore:mutate",
                "attributes": {
                  "livestore.mutateLabel": "mutate",
                },
                "children": [
                  {
                    "_name": "LiveStore:processWrites",
                    "attributes": {
                      "livestore.mutateLabel": "mutate",
                    },
                    "children": [
                      {
                        "_name": "LiveStore:mutatetWithoutRefresh",
                        "attributes": {
                          "livestore.args": "{
        "sql": "INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)"
      }",
                          "livestore.mutation": "livestore.RawSql",
                        },
                        "children": [
                          {
                            "_name": "livestore.in-memory-db:execute",
                            "attributes": {
                              "sql.query": "INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            "_name": "LiveStore:queries",
            "children": [
              {
                "_name": "sql:select * from todos where completed = 0",
                "attributes": {
                  "sql.query": "select * from todos where completed = 0",
                  "sql.rowsCount": 0,
                },
                "children": [
                  {
                    "_name": "js:where-filter",
                  },
                  {
                    "_name": "sql-in-memory-select",
                    "attributes": {
                      "sql.cached": false,
                      "sql.query": "select * from todos where completed = 0",
                      "sql.rowsCount": 0,
                    },
                  },
                ],
              },
              {
                "_name": "sql:select * from todos where completed = 0",
                "attributes": {
                  "sql.query": "select * from todos where completed = 0",
                  "sql.rowsCount": 1,
                },
                "children": [
                  {
                    "_name": "sql-in-memory-select",
                    "attributes": {
                      "sql.cached": false,
                      "sql.query": "select * from todos where completed = 0",
                      "sql.rowsCount": 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
      }
    `)
  })
})
