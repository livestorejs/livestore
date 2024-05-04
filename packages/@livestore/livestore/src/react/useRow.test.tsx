import { mutationForQueryInfo } from '@livestore/common'
import { ReadonlyRecord } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { render, renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import type { Todo } from '../__tests__/react/fixture.js'
import { makeTodoMvc, todos } from '../__tests__/react/fixture.js'
import { getSimplifiedRootSpan } from '../__tests__/react/utils/otel.js'
import * as LiveStore from '../index.js'
import * as LiveStoreReact from './index.js'
import type { StackInfo } from './utils/stack-info.js'

// NOTE running tests concurrently doesn't work with the default global db graph
describe.concurrent('useRow', () => {
  it('should update the data based on component key', async () => {
    using inputs = await makeTodoMvc({ useGlobalDbGraph: false })

    const { wrapper, AppComponentSchema, store, dbGraph, makeRenderCount } = inputs

    const renderCount = makeRenderCount()

    const { result, rerender } = renderHook(
      (userId: string) => {
        renderCount.inc()

        const [state, setState] = LiveStoreReact.useRow(AppComponentSchema, userId, { dbGraph })
        return { state, setState }
      },
      { wrapper, initialProps: 'u1' },
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('')
    expect(renderCount.val).toBe(1)

    React.act(() =>
      store.mutate(
        LiveStore.rawSqlMutation({
          sql: LiveStore.sql`INSERT INTO UserInfo (id, username) VALUES ('u2', 'username_u2')`,
        }),
      ),
    )

    rerender('u2')

    expect(result.current.state.id).toBe('u2')
    expect(result.current.state.username).toBe('username_u2')
    expect(renderCount.val).toBe(2)
  })

  it('should update the data reactively - via setState', async () => {
    using inputs = await makeTodoMvc({ useGlobalDbGraph: false })

    const { wrapper, AppComponentSchema, dbGraph, makeRenderCount } = inputs

    const renderCount = makeRenderCount()

    const { result } = renderHook(
      (userId: string) => {
        renderCount.inc()

        const [state, setState] = LiveStoreReact.useRow(AppComponentSchema, userId, { dbGraph })
        return { state, setState }
      },
      { wrapper, initialProps: 'u1' },
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('')
    expect(renderCount.val).toBe(1)

    React.act(() => result.current.setState.username('username_u1_hello'))

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('username_u1_hello')
    expect(renderCount.val).toBe(2)
  })

  it('should update the data reactively - via raw store mutation', async () => {
    using inputs = await makeTodoMvc({ useGlobalDbGraph: false })

    const { wrapper, AppComponentSchema, store, dbGraph, makeRenderCount } = inputs

    const renderCount = makeRenderCount()

    const { result } = renderHook(
      (userId: string) => {
        renderCount.inc()

        const [state, setState] = LiveStoreReact.useRow(AppComponentSchema, userId, { dbGraph })
        return { state, setState }
      },
      { wrapper, initialProps: 'u1' },
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('')
    expect(renderCount.val).toBe(1)

    React.act(() =>
      store.mutate(
        LiveStore.rawSqlMutation({
          sql: LiveStore.sql`UPDATE UserInfo SET username = 'username_u1_hello' WHERE id = 'u1';`,
        }),
      ),
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('username_u1_hello')
    expect(renderCount.val).toBe(2)
  })

  it('should work for a larger app', async () => {
    using inputs = await makeTodoMvc({ useGlobalDbGraph: false })
    const { wrapper, store, dbGraph, makeRenderCount, AppRouterSchema } = inputs

    const allTodos$ = LiveStore.querySQL<Todo[]>(`select * from todos`, { label: 'allTodos', dbGraph })

    const appRouterRenderCount = makeRenderCount()
    let globalSetState: LiveStoreReact.StateSetters<typeof AppRouterSchema> | undefined
    const AppRouter: React.FC = () => {
      appRouterRenderCount.inc()

      const [state, setState] = LiveStoreReact.useRow(AppRouterSchema, { dbGraph })

      globalSetState = setState

      return (
        <div>
          <TasksList setTaskId={setState.currentTaskId} />
          <div role="current-id">Current Task Id: {state.currentTaskId ?? '-'}</div>
          {state.currentTaskId ? <TaskDetails id={state.currentTaskId} /> : <div>Click on a task to see details</div>}
        </div>
      )
    }

    const TasksList: React.FC<{ setTaskId: (_: string) => void }> = ({ setTaskId }) => {
      const allTodos = LiveStoreReact.useQuery(allTodos$)

      return (
        <div>
          {allTodos.map((_) => (
            <div key={_.id} onClick={() => setTaskId(_.id)}>
              {_.id}
            </div>
          ))}
        </div>
      )
    }

    const TaskDetails: React.FC<{ id: string }> = ({ id }) => {
      const [todo] = LiveStoreReact.useRow(todos, id, { dbGraph })
      return <div role="content">{JSON.stringify(todo)}</div>
    }

    const renderResult = render(<AppRouter />, { wrapper })

    expect(appRouterRenderCount.val).toBe(1)

    React.act(() =>
      store.mutate(
        LiveStore.rawSqlMutation({
          sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
        }),
      ),
    )

    expect(appRouterRenderCount.val).toBe(1)
    expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: -"')

    React.act(() => globalSetState!.currentTaskId('t1'))

    expect(appRouterRenderCount.val).toBe(2)
    expect(renderResult.getByRole('content').innerHTML).toMatchInlineSnapshot(
      `"{"id":"t1","text":"buy milk","completed":false}"`,
    )

    expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t1"')

    React.act(() =>
      store.mutate(
        LiveStore.rawSqlMutation({
          sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t2', 'buy eggs', 0)`,
        }),
        mutationForQueryInfo({ _tag: 'Col', table: AppRouterSchema, column: 'currentTaskId', id: 'singleton' }, 't2'),
        LiveStore.rawSqlMutation({
          sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t3', 'buy bread', 0)`,
        }),
      ),
    )

    expect(appRouterRenderCount.val).toBe(3)
    expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t2"')
  })

  it('should work for a useRow query chained with a useTemporary query', async () => {
    using inputs = await makeTodoMvc({ useGlobalDbGraph: false })
    const { store, wrapper, AppComponentSchema, dbGraph, makeRenderCount, cud } = inputs
    const renderCount = makeRenderCount()

    store.mutate(
      cud.todos.insert({ id: 't1', text: 'buy milk', completed: false }),
      cud.todos.insert({ id: 't2', text: 'buy bread', completed: false }),
    )

    const { result, unmount, rerender } = renderHook(
      (userId: string) => {
        renderCount.inc()

        const [_row, _setRow, rowState$] = LiveStoreReact.useRow(AppComponentSchema, userId, { dbGraph })
        const todos = LiveStoreReact.useTemporaryQuery(
          () =>
            LiveStore.querySQL<any[]>(
              (get) => LiveStore.sql`select * from todos where text like '%${get(rowState$).text}%'`,
              { dbGraph, label: 'todosFiltered' },
            ),
          userId,
        )

        return { todos }
      },
      { wrapper, initialProps: 'u1' },
    )

    React.act(() =>
      store.mutate(
        LiveStore.rawSqlMutation({
          sql: LiveStore.sql`INSERT INTO UserInfo (id, username, text) VALUES ('u2', 'username_u2', 'milk')`,
        }),
      ),
    )

    expect(result.current.todos.length).toBe(2)
    // expect(result.current.state.username).toBe('')
    expect(renderCount.val).toBe(1)

    rerender('u2')

    expect(result.current.todos.length).toBe(1)
    expect(renderCount.val).toBe(2)

    unmount()
  })

  let cachedProvider: BasicTracerProvider | undefined

  describe('otel', () => {
    const exporter = new InMemorySpanExporter()

    const provider = cachedProvider ?? new BasicTracerProvider()
    cachedProvider = provider
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    provider.register()

    const otelTracer = otel.trace.getTracer('test')

    const span = otelTracer.startSpan('test')
    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    it('should update the data based on component key', async () => {
      using inputs = await makeTodoMvc({ useGlobalDbGraph: false, otelContext, otelTracer })

      const { wrapper, AppComponentSchema, store, dbGraph, makeRenderCount, strictMode } = inputs

      const renderCount = makeRenderCount()

      const { result, rerender, unmount } = renderHook(
        (userId: string) => {
          renderCount.inc()

          const [state, setState] = LiveStoreReact.useRow(AppComponentSchema, userId, { dbGraph })
          return { state, setState }
        },
        { wrapper, initialProps: 'u1' },
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('')
      expect(renderCount.val).toBe(1)

      React.act(() =>
        store.mutate(
          LiveStore.rawSqlMutation({
            sql: LiveStore.sql`INSERT INTO UserInfo (id, username) VALUES ('u2', 'username_u2')`,
          }),
        ),
      )

      rerender('u2')

      expect(result.current.state.id).toBe('u2')
      expect(result.current.state.username).toBe('username_u2')
      expect(renderCount.val).toBe(2)

      unmount()
      store.destroy()
      span.end()

      const mapAttributes = (attributes: otel.Attributes) => {
        return ReadonlyRecord.map(attributes, (val, key) => {
          if (key === 'stackInfo') {
            const stackInfo = JSON.parse(val as string) as StackInfo
            // stackInfo.frames.shift() // Removes `renderHook.wrapper` from the stack
            stackInfo.frames.forEach((_) => {
              if (_.name.includes('renderHook.wrapper')) {
                _.name = 'renderHook.wrapper'
              }
              _.filePath = '__REPLACED_FOR_SNAPSHOT__'
            })
            return JSON.stringify(stackInfo)
          }
          return val
        })
      }

      if (strictMode) {
        expect(getSimplifiedRootSpan(exporter, mapAttributes)).toMatchInlineSnapshot(`
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
            "sql": "INSERT INTO UserInfo (id, username) VALUES ('u2', 'username_u2')"
          }",
                              "livestore.mutation": "livestore.RawSql",
                            },
                            "children": [
                              {
                                "_name": "livestore.in-memory-db:execute",
                                "attributes": {
                                  "sql.query": "INSERT INTO UserInfo (id, username) VALUES ('u2', 'username_u2')",
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
                    "_name": "sql:select * from UserInfo where id = 'u1' limit 1",
                    "attributes": {
                      "sql.query": "select * from UserInfo where id = 'u1' limit 1",
                      "sql.rowsCount": 1,
                    },
                    "children": [
                      {
                        "_name": "sql-in-memory-select",
                        "attributes": {
                          "sql.cached": false,
                          "sql.query": "select * from UserInfo where id = 'u1' limit 1",
                          "sql.rowsCount": 1,
                        },
                      },
                    ],
                  },
                  {
                    "_name": "LiveStore:useRow:UserInfo:u1",
                    "attributes": {
                      "id": "u1",
                    },
                    "children": [
                      {
                        "_name": "livestore.in-memory-db:execute",
                        "attributes": {
                          "sql.query": "insert into UserInfo (username, text, id) select $username, $text, $id where not exists(select 1 from UserInfo where id = 'u1')",
                        },
                      },
                      {
                        "_name": "LiveStore:useQuery:sql(rowQuery:query:UserInfo:u1)",
                        "attributes": {
                          "label": "sql(rowQuery:query:UserInfo:u1)",
                          "stackInfo": "{"frames":[{"name":"renderHook.wrapper","filePath":"__REPLACED_FOR_SNAPSHOT__"},{"name":"useRow","filePath":"__REPLACED_FOR_SNAPSHOT__"}]}",
                        },
                        "children": [
                          {
                            "_name": "sql:select * from UserInfo where id = 'u1' limit 1",
                            "attributes": {
                              "sql.query": "select * from UserInfo where id = 'u1' limit 1",
                              "sql.rowsCount": 1,
                            },
                            "children": [
                              {
                                "_name": "sql-in-memory-select",
                                "attributes": {
                                  "sql.cached": false,
                                  "sql.query": "select * from UserInfo where id = 'u1' limit 1",
                                  "sql.rowsCount": 1,
                                },
                              },
                            ],
                          },
                          {
                            "_name": "LiveStore.subscribe",
                            "attributes": {
                              "label": "sql(rowQuery:query:UserInfo:u1)",
                              "queryLabel": "sql(rowQuery:query:UserInfo:u1)",
                            },
                          },
                          {
                            "_name": "LiveStore.subscribe",
                            "attributes": {
                              "label": "sql(rowQuery:query:UserInfo:u1)",
                              "queryLabel": "sql(rowQuery:query:UserInfo:u1)",
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
        // Below: Strict mode disabled
      } else {
        expect(getSimplifiedRootSpan(exporter, mapAttributes)).toMatchInlineSnapshot(`
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
            "sql": "INSERT INTO UserInfo (id, username) VALUES ('u2', 'username_u2')"
          }",
                              "livestore.mutation": "livestore.RawSql",
                            },
                            "children": [
                              {
                                "_name": "livestore.in-memory-db:execute",
                                "attributes": {
                                  "sql.query": "INSERT INTO UserInfo (id, username) VALUES ('u2', 'username_u2')",
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
                    "_name": "sql:select * from UserInfo where id = 'u1' limit 1",
                    "attributes": {
                      "sql.query": "select * from UserInfo where id = 'u1' limit 1",
                      "sql.rowsCount": 1,
                    },
                    "children": [
                      {
                        "_name": "sql-in-memory-select",
                        "attributes": {
                          "sql.cached": false,
                          "sql.query": "select * from UserInfo where id = 'u1' limit 1",
                          "sql.rowsCount": 1,
                        },
                      },
                    ],
                  },
                  {
                    "_name": "LiveStore:useRow:UserInfo:u1",
                    "attributes": {
                      "id": "u1",
                    },
                    "children": [
                      {
                        "_name": "livestore.in-memory-db:execute",
                        "attributes": {
                          "sql.query": "insert into UserInfo (username, text, id) select $username, $text, $id where not exists(select 1 from UserInfo where id = 'u1')",
                        },
                      },
                      {
                        "_name": "LiveStore:useQuery:sql(rowQuery:query:UserInfo:u1)",
                        "attributes": {
                          "label": "sql(rowQuery:query:UserInfo:u1)",
                          "stackInfo": "{"frames":[{"name":"renderHook.wrapper","filePath":"__REPLACED_FOR_SNAPSHOT__"},{"name":"useRow","filePath":"__REPLACED_FOR_SNAPSHOT__"}]}",
                        },
                        "children": [
                          {
                            "_name": "sql:select * from UserInfo where id = 'u1' limit 1",
                            "attributes": {
                              "sql.query": "select * from UserInfo where id = 'u1' limit 1",
                              "sql.rowsCount": 1,
                            },
                            "children": [
                              {
                                "_name": "sql-in-memory-select",
                                "attributes": {
                                  "sql.cached": false,
                                  "sql.query": "select * from UserInfo where id = 'u1' limit 1",
                                  "sql.rowsCount": 1,
                                },
                              },
                            ],
                          },
                          {
                            "_name": "LiveStore.subscribe",
                            "attributes": {
                              "label": "sql(rowQuery:query:UserInfo:u1)",
                              "queryLabel": "sql(rowQuery:query:UserInfo:u1)",
                            },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    "_name": "LiveStore:useRow:UserInfo:u2",
                    "attributes": {
                      "id": "u2",
                    },
                    "children": [
                      {
                        "_name": "livestore.in-memory-db:execute",
                        "attributes": {
                          "sql.query": "insert into UserInfo (username, text, id) select $username, $text, $id where not exists(select 1 from UserInfo where id = 'u2')",
                        },
                      },
                      {
                        "_name": "LiveStore:useQuery:sql(rowQuery:query:UserInfo:u2)",
                        "attributes": {
                          "label": "sql(rowQuery:query:UserInfo:u2)",
                          "stackInfo": "{"frames":[{"name":"renderHook.wrapper","filePath":"__REPLACED_FOR_SNAPSHOT__"},{"name":"useRow","filePath":"__REPLACED_FOR_SNAPSHOT__"}]}",
                        },
                        "children": [
                          {
                            "_name": "sql:select * from UserInfo where id = 'u2' limit 1",
                            "attributes": {
                              "sql.query": "select * from UserInfo where id = 'u2' limit 1",
                              "sql.rowsCount": 1,
                            },
                            "children": [
                              {
                                "_name": "sql-in-memory-select",
                                "attributes": {
                                  "sql.cached": false,
                                  "sql.query": "select * from UserInfo where id = 'u2' limit 1",
                                  "sql.rowsCount": 1,
                                },
                              },
                            ],
                          },
                          {
                            "_name": "LiveStore.subscribe",
                            "attributes": {
                              "label": "sql(rowQuery:query:UserInfo:u2)",
                              "queryLabel": "sql(rowQuery:query:UserInfo:u2)",
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
      }
    })
  })
})
