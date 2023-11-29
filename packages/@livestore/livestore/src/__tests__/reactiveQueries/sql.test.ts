import * as otel from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it } from 'vitest'

import { queryJS, querySQL, sql } from '../../index.js'
import { makeTodoMvc } from '../react/fixture.js'

describe('otel', () => {
  let cachedProvider: BasicTracerProvider | undefined

  const makeQuery = async () => {
    const exporter = new InMemorySpanExporter()

    const provider = cachedProvider ?? new BasicTracerProvider()
    cachedProvider = provider
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    provider.register()

    const tracer = otel.trace.getTracer('test')

    const span = tracer.startSpan('test')
    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    const { store } = await makeTodoMvc({ otelTracer: tracer, otelContext })

    return { store, tracer, exporter, span, provider }
  }

  it('otel', async () => {
    const { store, exporter, span } = await makeQuery()

    const query = querySQL(`select * from todos`, { queriedTables: new Set(['todos']) })
    expect(query.run()).toMatchInlineSnapshot('[]')

    store.applyEvent('livestore.RawSql', {
      sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);`,
      writeTables: ['todos'],
    })

    expect(query.run()).toMatchInlineSnapshot(`
      [
        {
          "completed": 0,
          "id": "t1",
          "text": "buy milk",
        },
      ]
    `)

    store.destroy()
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
            "_name": "sql-in-memory-select",
            "attributes": {
              "sql.cached": false,
              "sql.query": "SELECT * FROM __livestore_schema",
              "sql.rowsCount": 0,
            },
          },
          {
            "_name": "livestore.in-memory-db:execute",
            "attributes": {
              "sql.query": "INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all');",
            },
          },
          {
            "_name": "LiveStore:applyEvents",
            "children": [
              {
                "_name": "LiveStore:applyEvent",
                "children": [
                  {
                    "_name": "LiveStore:applyEventWithoutRefresh",
                    "attributes": {
                      "livestore.actionType": "livestore.RawSql",
                      "livestore.args": "{
        \\"sql\\": \\"INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);\\",
        \\"writeTables\\": [
          \\"todos\\"
        ]
      }",
                    },
                    "children": [
                      {
                        "_name": "livestore.in-memory-db:execute",
                        "attributes": {
                          "sql.query": "INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);",
                        },
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
    const { store, exporter, span } = await makeQuery()

    const defaultTodo = { id: '', text: '', completed: 0 }

    const filter = queryJS(() => `where completed = 0`, { label: 'where-filter' })
    const query = querySQL((get) => `select * from todos ${get(filter)}`, { label: 'all todos' }).getFirstRow({
      defaultValue: defaultTodo,
    })

    expect(query.run()).toMatchInlineSnapshot(`
      {
        "completed": 0,
        "id": "",
        "text": "",
      }
    `)

    store.applyEvent('livestore.RawSql', {
      sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);`,
      writeTables: ['todos'],
    })

    expect(query.run()).toMatchInlineSnapshot(`
      {
        "completed": 0,
        "id": "t1",
        "text": "buy milk",
      }
    `)

    store.destroy()
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
            "_name": "sql-in-memory-select",
            "attributes": {
              "sql.cached": false,
              "sql.query": "SELECT * FROM __livestore_schema",
              "sql.rowsCount": 0,
            },
          },
          {
            "_name": "livestore.in-memory-db:execute",
            "attributes": {
              "sql.query": "INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all');",
            },
          },
          {
            "_name": "LiveStore:applyEvents",
            "children": [
              {
                "_name": "LiveStore:applyEvent",
                "children": [
                  {
                    "_name": "LiveStore:applyEventWithoutRefresh",
                    "attributes": {
                      "livestore.actionType": "livestore.RawSql",
                      "livestore.args": "{
        \\"sql\\": \\"INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);\\",
        \\"writeTables\\": [
          \\"todos\\"
        ]
      }",
                    },
                    "children": [
                      {
                        "_name": "livestore.in-memory-db:execute",
                        "attributes": {
                          "sql.query": "INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);",
                        },
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
                "_name": "js:sql(all todos):first",
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
                ],
              },
              {
                "_name": "js:sql(all todos):first",
                "children": [
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
          },
        ],
      }
    `)
  })
})

const compareHrTime = (a: [number, number], b: [number, number]) => {
  if (a[0] !== b[0]) return a[0] - b[0]
  return a[1] - b[1]
}

const omitEmpty = (obj: any) => {
  const result: any = {}
  for (const key in obj) {
    if (
      obj[key] !== undefined &&
      !(Array.isArray(obj[key]) && obj[key].length === 0) &&
      Object.keys(obj[key]).length > 0
    ) {
      result[key] = obj[key]
    }
  }
  return result
}

const getSimplifiedRootSpan = (exporter: InMemorySpanExporter) => {
  const spans = exporter.getFinishedSpans()
  const spansMap = new Map<string, NestedSpan>(spans.map((span) => [span.spanContext().spanId, { span, children: [] }]))

  spansMap.forEach((nestedSpan) => {
    const parentSpan = nestedSpan.span.parentSpanId ? spansMap.get(nestedSpan.span.parentSpanId) : undefined
    if (parentSpan) {
      parentSpan.children.push(nestedSpan)
    }
  })

  type NestedSpan = { span: ReadableSpan; children: NestedSpan[] }
  const rootSpan = spansMap.get(spans.find((_) => _.name === 'test')!.spanContext().spanId)!

  type SimplifiedNestedSpan = { _name: string; attributes: any; children: SimplifiedNestedSpan[] }

  const simplifySpan = (span: NestedSpan): SimplifiedNestedSpan =>
    omitEmpty({
      _name: span.span.name,
      attributes: span.span.attributes,
      children: span.children
        .filter((_) => _.span.name !== 'createStore')
        .sort((a, b) => compareHrTime(a.span.startTime, b.span.startTime))
        .map(simplifySpan),
    })

  // console.dir(
  //   spans.map((_) => [_.spanContext().spanId, _.name, _.attributes, _.parentSpanId]),
  //   { depth: 10 },
  // )

  return simplifySpan(rootSpan)
}
